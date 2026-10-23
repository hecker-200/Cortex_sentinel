import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { DOMAINS } from '../../src/engine/config';
import { PERSONAS, runPersonaChecks, simulateTrainee } from '../../src/engine/simulate';
import { randomBytes } from 'node:crypto';
import { hashPassword, requireRole } from '../auth';
import type { Db } from '../db';
import { bad, h, notFound, sendMedia, toBuffer } from '../http';
import { audit, insertAttempt, insertDecision, insertPair, loadCase, loadCases } from '../repo';
import { newJoinCode } from './cohorts';

const Option = z.object({ value: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(120) });
const AiOut = z.object({
  answer: z.string().min(1).max(40),
  confidence: z.number().min(0).max(1),
  errorType: z.enum(['none', 'missed-finding', 'over-call', 'wrong-grade']),
});
const CaseBody = z
  .object({
    pairId: z.string().trim().min(1).max(40),
    domain: z.enum(DOMAINS),
    question: z.string().trim().min(5).max(300),
    options: z.array(Option).min(2).max(6),
    answer: z.string().min(1).max(40),
    difficulty: z.number().int().min(1).max(3),
    rationale: z.string().trim().min(10).max(2000),
    lookFor: z.string().trim().min(10).max(2000),
    aiCorrect: AiOut,
    aiWrong: AiOut,
    viewLabel: z.string().trim().min(1).max(20).default('A4C'),
    active: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    const vals = c.options.map((o) => o.value);
    if (new Set(vals).size !== vals.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'option values must be unique' });
    if (!vals.includes(c.answer)) ctx.addIssue({ code: 'custom', path: ['answer'], message: 'must be one of the options' });
    if (c.aiCorrect.answer !== c.answer) ctx.addIssue({ code: 'custom', path: ['aiCorrect', 'answer'], message: 'must equal the reference answer' });
    if (c.aiWrong.answer === c.answer || !vals.includes(c.aiWrong.answer))
      ctx.addIssue({ code: 'custom', path: ['aiWrong', 'answer'], message: 'must be a different option from the reference answer' });
    if (c.aiWrong.errorType === 'none') ctx.addIssue({ code: 'custom', path: ['aiWrong', 'errorType'], message: 'pick the error type' });
  });

export function adminRoutes(db: Db) {
  const r = Router();

  // Educators (clinical reviewers) and admins can read cases and sign them off
  const staff = requireRole('educator', 'admin');
  const admin = requireRole('admin');

  r.get(
    '/cases',
    staff,
    h(async (_req, res) => {
      res.json(await loadCases(db, { activeOnly: false }));
    }),
  );

  r.get(
    '/cases/:id/clip',
    staff,
    h(async (req, res) => {
      const { rows } = await db.query(`SELECT clip_mime, clip_data FROM cases WHERE id = $1`, [req.params.id]);
      const buf = toBuffer(rows[0]?.clip_data);
      if (!buf) throw notFound('No clip for this case');
      sendMedia(req, res, buf, rows[0].clip_mime ?? 'video/mp4');
    }),
  );

  r.post(
    '/cases',
    admin,
    h(async (req, res) => {
      const id = z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/, 'use letters, digits, - or _').parse(req.body.id);
      const c = CaseBody.parse(req.body);
      const exists = await db.query(`SELECT 1 FROM cases WHERE id = $1`, [id]);
      if (exists.rows.length) throw bad('A case with this ID already exists');
      await db.query(
        `INSERT INTO cases (id, pair_id, domain, question, options, answer, difficulty, rationale, look_for, ai_correct, ai_wrong, view_label, active)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)`,
        [id, c.pairId, c.domain, c.question, JSON.stringify(c.options), c.answer, c.difficulty, c.rationale, c.lookFor,
          JSON.stringify(c.aiCorrect), JSON.stringify(c.aiWrong), c.viewLabel, c.active],
      );
      await audit(db, req.user!.id, 'case.create', { caseId: id });
      res.status(201).json(await loadCase(db, id));
    }),
  );

  r.put(
    '/cases/:id',
    admin,
    h(async (req, res) => {
      const prev = await loadCase(db, req.params.id);
      if (!prev) throw notFound('Case not found');
      const c = CaseBody.parse(req.body);
      // Any content change sends the case back for clinical review
      const contentChanged =
        JSON.stringify([prev.pairId, prev.domain, prev.question, prev.options, prev.answer, prev.difficulty, prev.rationale, prev.lookFor, prev.ai.correct, prev.ai.wrong, prev.viewLabel]) !==
        JSON.stringify([c.pairId, c.domain, c.question, c.options, c.answer, c.difficulty, c.rationale, c.lookFor, c.aiCorrect, c.aiWrong, c.viewLabel]);
      await db.query(
        `UPDATE cases SET pair_id=$2, domain=$3, question=$4, options=$5::jsonb, answer=$6, difficulty=$7, rationale=$8, look_for=$9,
            ai_correct=$10::jsonb, ai_wrong=$11::jsonb, view_label=$12, active=$13, updated_at=now(),
            version = version + CASE WHEN $14::boolean THEN 1 ELSE 0 END,
            status = CASE WHEN $14::boolean THEN 'draft' ELSE status END,
            reviewed_by = CASE WHEN $14::boolean THEN NULL ELSE reviewed_by END,
            reviewed_at = CASE WHEN $14::boolean THEN NULL ELSE reviewed_at END
          WHERE id = $1`,
        [prev.id, c.pairId, c.domain, c.question, JSON.stringify(c.options), c.answer, c.difficulty, c.rationale, c.lookFor,
          JSON.stringify(c.aiCorrect), JSON.stringify(c.aiWrong), c.viewLabel, c.active, contentChanged],
      );
      await audit(db, req.user!.id, 'case.update', { caseId: prev.id, contentChanged, active: c.active });
      res.json(await loadCase(db, prev.id));
    }),
  );

  r.put(
    '/cases/:id/clip',
    admin,
    express.raw({ type: ['video/mp4', 'video/webm', 'video/quicktime'], limit: '25mb' }),
    h(async (req, res) => {
      const prev = await loadCase(db, req.params.id);
      if (!prev) throw notFound('Case not found');
      const mime = String(req.headers['content-type'] ?? '').split(';')[0];
      if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw bad('Upload an MP4 or WebM video file');
      const source = z.string().max(200).optional().parse(req.headers['x-clip-source'] ?? undefined);
      await db.query(
        `UPDATE cases SET clip_mime = $2, clip_data = $3, clip_source = $4, version = version + 1, status = 'draft',
            reviewed_by = NULL, reviewed_at = NULL, updated_at = now() WHERE id = $1`,
        [prev.id, mime, req.body, source ?? 'uploaded'],
      );
      await audit(db, req.user!.id, 'case.clip', { caseId: prev.id, bytes: req.body.length, mime });
      res.json(await loadCase(db, prev.id));
    }),
  );

  r.post(
    '/cases/:id/review',
    staff,
    h(async (req, res) => {
      const body = z.object({ status: z.enum(['reviewed', 'draft']), note: z.string().trim().max(1000).optional() }).parse(req.body);
      const prev = await loadCase(db, req.params.id);
      if (!prev) throw notFound('Case not found');
      if (body.status === 'reviewed' && !prev.hasClip) throw bad('Add a clip before signing off this case');
      await db.query(
        `UPDATE cases SET status = $2, reviewed_by = $3, reviewed_at = CASE WHEN $2 = 'reviewed' THEN now() ELSE NULL END,
            review_note = $4, updated_at = now() WHERE id = $1`,
        [prev.id, body.status, body.status === 'reviewed' ? req.user!.id : null, body.note ?? null],
      );
      await audit(db, req.user!.id, body.status === 'reviewed' ? 'case.signoff' : 'case.reopen', { caseId: prev.id, version: prev.version, note: body.note });
      res.json(await loadCase(db, prev.id));
    }),
  );

  r.get(
    '/users',
    admin,
    h(async (_req, res) => {
      const { rows } = await db.query(
        `SELECT u.id, u.name, u.email, u.role, u.created_at, u.consent_at,
                (SELECT count(*)::int FROM attempts a WHERE a.user_id = u.id) AS attempts
           FROM users u WHERE NOT u.is_simulated ORDER BY u.created_at`,
      );
      res.json(
        rows.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          attempts: Number(u.attempts),
          createdAt: new Date(u.created_at).getTime(),
          consented: Boolean(u.consent_at),
        })),
      );
    }),
  );

  r.put(
    '/users/:id/role',
    admin,
    h(async (req, res) => {
      const { role } = z.object({ role: z.enum(['trainee', 'educator', 'admin']) }).parse(req.body);
      if (req.params.id === req.user!.id && role !== 'admin') throw bad('You cannot remove your own admin role');
      const { rows } = await db.query(`UPDATE users SET role = $2 WHERE id = $1 AND NOT is_simulated RETURNING id`, [req.params.id, role]);
      if (!rows[0]) throw notFound('User not found');
      await audit(db, req.user!.id, 'user.role', { userId: req.params.id, role });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/users/:id/temp-password',
    admin,
    h(async (req, res) => {
      const temp = randomBytes(9).toString('base64url');
      const { rows } = await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1 AND NOT is_simulated RETURNING id, name`, [
        req.params.id,
        await hashPassword(temp),
      ]);
      if (!rows[0]) throw notFound('User not found');
      await db.query(`DELETE FROM sessions WHERE user_id = $1`, [req.params.id]);
      await audit(db, req.user!.id, 'user.temp-password', { userId: req.params.id });
      res.json({ name: rows[0].name, tempPassword: temp });
    }),
  );

  r.get(
    '/policy-checks',
    staff,
    h(async (_req, res) => {
      const cases = await loadCases(db, { activeOnly: true });
      if (!cases.length) throw bad('No active cases with clips');
      res.json(
        runPersonaChecks(cases, 40).map((c) => ({
          key: c.persona.key,
          name: c.persona.name.replace(/^Sim · /, ''),
          description: c.persona.description,
          expected: c.persona.expected ?? null,
          passed: c.passed,
          firstFiredAt: c.firstFiredAt,
          rulesFired: c.rulesFired,
        })),
      );
    }),
  );

  // Demo cohort of simulated trainees, so the educator view can be shown before real users exist
  r.post(
    '/demo-cohort',
    staff,
    h(async (req, res) => {
      const cases = await loadCases(db, { activeOnly: true });
      if (!cases.length) throw bad('No active cases with clips');
      const cohortId = await db.tx(async (q) => {
        const code = newJoinCode();
        const { rows } = await q.query(
          `INSERT INTO cohorts (name, join_code, owner_id, is_demo) VALUES ('Demo cohort (simulated)', $1, $2, true) RETURNING id`,
          [code, req.user!.id],
        );
        const cid = rows[0].id as string;
        const t0 = Date.now() - 3 * 86_400_000;
        for (const [i, p] of PERSONAS.entries()) {
          const u = await q.query(
            `INSERT INTO users (name, role, is_simulated, persona) VALUES ($1, 'trainee', true, $2) RETURNING id`,
            [p.name, p.key],
          );
          const uid = u.rows[0].id as string;
          await q.query(`INSERT INTO cohort_members (cohort_id, user_id) VALUES ($1, $2)`, [cid, uid]);
          const sim = simulateTrainee(p, cases, 40, `demo-${cid}`, t0 + i * 3_600_000);
          const idMap = new Map<string, string>();
          for (const pr of Object.values(sim.pairs)) await insertPair(q, uid, pr);
          for (const d of sim.decisions) {
            const newId = randomUUID();
            idMap.set(d.id, newId);
            const v = cases.find((c) => c.id === d.caseId)!.version;
            await insertDecision(q, { ...d, id: newId, traineeId: uid }, v, new Date(d.at), 'done');
          }
          for (const a of sim.attempts) {
            const v = cases.find((c) => c.id === a.caseId)!.version;
            await insertAttempt(q, { ...a, id: randomUUID(), traineeId: uid, decisionId: idMap.get(a.decisionId)! }, v);
          }
        }
        await audit(q, req.user!.id, 'cohort.demo', { cohortId: cid });
        return cid;
      });
      res.status(201).json({ id: cohortId });
    }),
  );

  r.get(
    '/audit',
    admin,
    h(async (_req, res) => {
      const { rows } = await db.query(
        `SELECT l.id, l.action, l.detail, l.created_at, u.name AS user_name
           FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 100`,
      );
      res.json(
        rows.map((x) => ({
          id: Number(x.id),
          action: x.action,
          detail: typeof x.detail === 'string' ? JSON.parse(x.detail) : x.detail,
          at: new Date(x.created_at).getTime(),
          userName: x.user_name,
        })),
      );
    }),
  );

  return r;
}
