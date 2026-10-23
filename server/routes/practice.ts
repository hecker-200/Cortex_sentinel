import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Attempt } from '../../src/types';
import { aiOutputFor, makeAttempt } from '../../src/engine/attempt';
import { DOMAINS } from '../../src/engine/config';
import { computeMetrics } from '../../src/engine/metrics';
import { decideNext } from '../../src/engine/policy';
import { COOKIE, checkPassword, destroySession, hashPassword, rateLimit, requireUser } from '../auth';
import type { Config } from '../config';
import type { Db, Queryable } from '../db';
import { HttpError, bad, h, notFound, sendMedia, toBuffer } from '../http';
import {
  audit,
  insertAttempt,
  insertDecision,
  insertPair,
  loadAttempts,
  loadCase,
  loadCases,
  loadPairs,
  rowToAttempt,
  rowToDecision,
  type CaseRow,
  type DecisionRow,
} from '../repo';

export const REFLECTIONS = ['The AI sounded more certain than me', "I wasn't sure of my own read", 'I saw something new in the clip'];

/** What the trainee may see before answering. No answer, AI read, case ID or rationale. */
function presentOpen(d: DecisionRow, c: CaseRow, caseNumber: number) {
  const ai = aiOutputFor(c, d);
  return {
    decisionId: d.id,
    caseNumber,
    state: d.state,
    mode: d.mode,
    reasonCode: d.reasonCode,
    explanation: d.explanation,
    flags: d.flags,
    case: {
      domain: c.domain,
      question: c.question,
      options: c.options,
      view: c.viewLabel,
      clipUrl: `/api/practice/${d.id}/clip`,
      lookFor: d.mode === 'guided' ? c.lookFor : undefined,
    },
    ai: d.mode === 'ai-first' || d.state === 'awaiting_final' ? { answer: ai.answer, confidence: ai.confidence } : undefined,
    initial:
      d.state === 'awaiting_final' ? { answer: d.initialAnswer, confidence: d.initialConfidence } : undefined,
  };
}

/** Everything revealed after the case is finished. */
function presentFeedback(a: Attempt, c: CaseRow, d: DecisionRow) {
  const ai = a.aiShown ? aiOutputFor(c, d) : null;
  return {
    attempt: a,
    case: { id: c.id, pairId: c.pairId, difficulty: c.difficulty, status: c.status, options: c.options, answer: c.answer },
    rationale: c.rationale,
    lookFor: c.lookFor,
    ai: ai ? { answer: ai.answer, confidence: ai.confidence, correct: ai.answer === c.answer } : null,
    reflectionPrompt: Boolean(d.flags.reflection && a.switched),
    reflectionOptions: REFLECTIONS,
  };
}

async function openDecision(q: Queryable, userId: string): Promise<DecisionRow | null> {
  const { rows } = await q.query(`SELECT * FROM decisions WHERE user_id = $1 AND state <> 'done'`, [userId]);
  return rows[0] ? rowToDecision(rows[0]) : null;
}

async function ownDecision(q: Queryable, req: Request): Promise<DecisionRow> {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw notFound('Case not found');
  const { rows } = await q.query(`SELECT * FROM decisions WHERE id = $1 AND user_id = $2`, [id.data, req.user!.id]);
  if (!rows[0]) throw notFound('Case not found');
  return rowToDecision(rows[0]);
}

async function caseNumberFor(q: Queryable, userId: string) {
  const { rows } = await q.query(`SELECT count(*)::int AS n FROM attempts WHERE user_id = $1`, [userId]);
  return Number(rows[0].n) + 1;
}

async function finish(q: Queryable, d: DecisionRow, c: CaseRow, initial: string, initialConf: number, final: string, finalConf: number | null) {
  const a = makeAttempt({
    decision: d,
    c,
    initialAnswer: initial,
    initialConfidence: initialConf,
    finalAnswer: final,
    finalConfidence: finalConf,
    durationMs: Math.min(Date.now() - d.createdAt, 2_000_000_000),
  });
  a.id = randomUUID();
  await insertAttempt(q, a, d.caseVersion);
  await q.query(`UPDATE decisions SET state = 'done' WHERE id = $1`, [d.id]);
  return presentFeedback(a, c, d);
}

export function practiceRoutes(db: Db, cfg: Config) {
  const r = Router();
  r.use(requireUser);
  r.use((req, _res, next) => {
    if (req.user!.consentVersion !== cfg.consentVersion) return next(new HttpError(412, 'Please accept the consent statement first'));
    next();
  });

  // The next case: the open one, or a new one chosen by the policy engine
  r.get(
    '/next',
    h(async (req, res) => {
      const userId = req.user!.id;
      // Two tabs can ask at once; the unique open-decision index lets only one create a case,
      // so the other retries and picks that case up.
      const attempt = () => db.tx(async (q) => {
        let d = await openDecision(q, userId);
        if (!d) {
          const cases = await loadCases(q, { activeOnly: true });
          if (!cases.length) throw new HttpError(503, 'No cases are available yet. Ask an admin to add clips.');
          const attempts = await loadAttempts(q, [userId]);
          const pairs = await loadPairs(q, userId);
          const { decision, newPair } = decideNext({ traineeId: userId, attempts, cases, pairs });
          decision.id = randomUUID();
          const c = cases.find((x) => x.id === decision.caseId)!;
          if (newPair) await insertPair(q, userId, newPair);
          await insertDecision(q, decision, c.version);
          d = (await openDecision(q, userId))!;
        }
        const c = await loadCase(q, d.caseId);
        if (!c) throw notFound('Case was removed');
        return presentOpen(d, c, await caseNumberFor(q, userId));
      });
      let out;
      try {
        out = await attempt();
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e;
        out = await attempt();
      }
      res.json(out);
    }),
  );

  // The clip for an open case, addressed by decision so the case ID stays hidden
  r.get(
    '/:id/clip',
    h(async (req, res) => {
      const d = await ownDecision(db, req);
      const { rows } = await db.query(`SELECT clip_mime, clip_data FROM cases WHERE id = $1`, [d.caseId]);
      const buf = toBuffer(rows[0]?.clip_data);
      if (!buf) throw notFound('This case has no clip');
      sendMedia(req, res, buf, rows[0].clip_mime ?? 'video/mp4');
    }),
  );

  const AnswerBody = z.object({ answer: z.string().min(1).max(64), confidence: z.number().int().min(1).max(5) });

  r.post(
    '/:id/answer',
    h(async (req, res) => {
      const body = AnswerBody.parse(req.body);
      const out = await db.tx(async (q) => {
        const d = await ownDecision(q, req);
        if (d.state !== 'open') throw new HttpError(409, 'This case was already answered');
        const c = await loadCase(q, d.caseId);
        if (!c) throw notFound('Case was removed');
        if (!c.options.some((o) => o.value === body.answer)) throw bad('That is not one of the answer options');
        if (d.mode === 'human-first') {
          await q.query(
            `UPDATE decisions SET state = 'awaiting_final', initial_answer = $2, initial_confidence = $3, answered_at = now() WHERE id = $1`,
            [d.id, body.answer, body.confidence],
          );
          const ai = aiOutputFor(c, d);
          return { state: 'awaiting_final', ai: { answer: ai.answer, confidence: ai.confidence } };
        }
        return { state: 'done', feedback: await finish(q, d, c, body.answer, body.confidence, body.answer, null) };
      });
      res.json(out);
    }),
  );

  const FinalBody = z.object({ choice: z.enum(['keep', 'ai']), confidence: z.number().int().min(1).max(5) });

  r.post(
    '/:id/final',
    h(async (req, res) => {
      const body = FinalBody.parse(req.body);
      const out = await db.tx(async (q) => {
        const d = await ownDecision(q, req);
        if (d.state !== 'awaiting_final' || !d.initialAnswer || !d.initialConfidence) throw new HttpError(409, 'Answer the case first');
        const c = await loadCase(q, d.caseId);
        if (!c) throw notFound('Case was removed');
        const ai = aiOutputFor(c, d);
        const final = body.choice === 'ai' ? ai.answer : d.initialAnswer;
        return { state: 'done', feedback: await finish(q, d, c, d.initialAnswer, d.initialConfidence, final, body.confidence) };
      });
      res.json(out);
    }),
  );

  r.post(
    '/attempts/:id/reflection',
    h(async (req, res) => {
      const { text } = z.object({ text: z.enum(REFLECTIONS as [string, ...string[]]) }).parse(req.body);
      const id = z.string().uuid().parse(req.params.id);
      const { rows } = await db.query(
        `UPDATE attempts SET reflection = $3 WHERE id = $1 AND user_id = $2 AND switched RETURNING id`,
        [id, req.user!.id, text],
      );
      if (!rows[0]) throw notFound('Attempt not found');
      res.json({ ok: true });
    }),
  );

  return r;
}

/** Profile data for the signed-in trainee. */
export function meRoutes(db: Db, cfg: Config) {
  const r = Router();
  r.use(requireUser);

  r.post(
    '/consent',
    h(async (req, res) => {
      const { version } = z.object({ version: z.literal(cfg.consentVersion) }).parse(req.body);
      await db.query(`UPDATE users SET consent_version = $2, consent_at = now() WHERE id = $1`, [req.user!.id, version]);
      res.json({ ok: true, consentVersion: version });
    }),
  );

  r.get(
    '/summary',
    h(async (req, res) => {
      const userId = req.user!.id;
      const attempts = await loadAttempts(db, [userId]);
      const { rows } = await db.query(
        `SELECT d.id, d.created_at, d.case_id, d.mode, d.reason_code, d.explanation, d.state, a.outcome
           FROM decisions d LEFT JOIN attempts a ON a.decision_id = d.id
          WHERE d.user_id = $1 ORDER BY d.created_at DESC LIMIT 15`,
        [userId],
      );
      const cohorts = await db.query(
        `SELECT c.id, c.name FROM cohort_members m JOIN cohorts c ON c.id = m.cohort_id WHERE m.user_id = $1 ORDER BY c.name`,
        [userId],
      );
      res.json({
        total: attempts.length,
        metrics: Object.fromEntries(DOMAINS.map((d) => [d, computeMetrics(attempts, d)])),
        decisions: rows.map((x) => ({
          id: x.id,
          at: new Date(x.created_at).getTime(),
          // Hide the case ID while the case is still open
          caseId: x.state === 'done' ? x.case_id : null,
          mode: x.mode,
          reasonCode: x.reason_code,
          explanation: x.explanation,
          outcome: x.outcome ?? null,
        })),
        cohorts: cohorts.rows,
      });
    }),
  );

  r.post(
    '/password',
    h(async (req, res) => {
      rateLimit(`pw:${req.user!.id}`, 10, 15 * 60_000);
      const body = z
        .object({ current: z.string().min(1).max(200), next: z.string().min(8, 'must be at least 8 characters').max(200) })
        .parse(req.body);
      const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.id]);
      if (!rows[0]?.password_hash || !(await checkPassword(body.current, rows[0].password_hash))) throw bad('Your current password is incorrect');
      await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [req.user!.id, await hashPassword(body.next)]);
      res.json({ ok: true });
    }),
  );

  // Everything stored about the signed-in user, as a JSON download
  r.get(
    '/export',
    h(async (req, res) => {
      const id = req.user!.id;
      const u = await db.query(`SELECT name, email, role, consent_version, consent_at, created_at FROM users WHERE id = $1`, [id]);
      const cohorts = await db.query(
        `SELECT c.name, m.joined_at FROM cohort_members m JOIN cohorts c ON c.id = m.cohort_id WHERE m.user_id = $1 ORDER BY m.joined_at`,
        [id],
      );
      const decisions = await db.query(
        `SELECT id, created_at, domain, mode, case_id, reason_code, explanation, state FROM decisions WHERE user_id = $1 ORDER BY created_at`,
        [id],
      );
      const attempts = await loadAttempts(db, [id]);
      res.setHeader('Content-Disposition', 'attachment; filename="cortex-my-data.json"');
      res.json({
        exportedAt: new Date().toISOString(),
        account: u.rows[0],
        cohorts: cohorts.rows,
        // Open cases keep their case ID hidden, as in practice
        decisions: decisions.rows.map((d) => ({ ...d, case_id: d.state === 'done' ? d.case_id : null })),
        attempts,
      });
    }),
  );

  // Permanent self-service account deletion
  r.post(
    '/delete',
    h(async (req, res) => {
      rateLimit(`del:${req.user!.id}`, 10, 15 * 60_000);
      const body = z.object({ password: z.string().min(1).max(200), confirm: z.literal('DELETE', { errorMap: () => ({ message: 'Type DELETE to confirm' }) }) }).parse(req.body);
      const { rows } = await db.query(`SELECT password_hash, role FROM users WHERE id = $1`, [req.user!.id]);
      if (!rows[0]?.password_hash || !(await checkPassword(body.password, rows[0].password_hash))) throw bad('Your password is incorrect');
      if (rows[0].role === 'admin') {
        const others = await db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND id <> $1 AND NOT is_simulated`, [req.user!.id]);
        if (Number(others.rows[0].n) === 0) throw bad('You are the only admin. Make someone else an admin first.');
      }
      await destroySession(db, req);
      await db.tx(async (q) => {
        // Simulated demo trainees in cohorts this user owns go too
        await q.query(
          `DELETE FROM users WHERE is_simulated AND id IN (SELECT m.user_id FROM cohort_members m JOIN cohorts c ON c.id = m.cohort_id WHERE c.owner_id = $1)`,
          [req.user!.id],
        );
        await q.query(`DELETE FROM users WHERE id = $1`, [req.user!.id]);
        await audit(q, null, 'user.delete', { role: rows[0].role });
      });
      res.clearCookie(COOKIE, { path: '/' });
      res.json({ ok: true });
    }),
  );

  r.get(
    '/attempts',
    h(async (req, res) => {
      const { rows } = await db.query(`SELECT * FROM attempts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [req.user!.id]);
      res.json(rows.map(rowToAttempt));
    }),
  );

  return r;
}
