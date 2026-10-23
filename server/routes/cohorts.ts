import { randomInt } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Attempt, Domain } from '../../src/types';
import { DOMAINS } from '../../src/engine/config';
import { computeMetrics } from '../../src/engine/metrics';
import { requireRole, requireUser } from '../auth';
import type { Db, Queryable } from '../db';
import { bad, forbidden, h, notFound } from '../http';
import { audit, loadAttempts, loadCases } from '../repo';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newJoinCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

async function cohortFor(q: Queryable, req: Request) {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw notFound('Cohort not found');
  const { rows } = await q.query(`SELECT * FROM cohorts WHERE id = $1`, [id.data]);
  const c = rows[0];
  if (!c) throw notFound('Cohort not found');
  if (req.user!.role !== 'admin' && c.owner_id !== req.user!.id) throw forbidden();
  return c;
}

const CSV_COLS: (keyof Attempt)[] = [
  'caseId', 'pairId', 'domain', 'mode', 'pairSlot', 'aiShown', 'aiCorrect', 'aiAnswer', 'aiErrorType', 'initialAnswer',
  'initialConfidence', 'finalAnswer', 'finalConfidence', 'switched', 'firstCorrect', 'finalCorrect', 'outcome', 'reasonCode',
  'reflection', 'durationMs', 'createdAt',
];

export function toCsv(rows: Attempt[], pseudonym: (id: string) => string): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['trainee', ...CSV_COLS].join(',');
  const body = rows.map((r) =>
    [pseudonym(r.traineeId), ...CSV_COLS.map((c) => esc(c === 'createdAt' ? new Date(r.createdAt).toISOString() : r[c]))].join(','),
  );
  return [head, ...body].join('\n') + '\n';
}

export function cohortRoutes(db: Db) {
  const r = Router();
  r.use(requireUser);

  // Any signed-in user can join with a code
  r.post(
    '/join',
    h(async (req, res) => {
      const { code } = z.object({ code: z.string().trim().toUpperCase().min(4).max(12) }).parse(req.body);
      const { rows } = await db.query(`SELECT id, name FROM cohorts WHERE join_code = $1`, [code]);
      if (!rows[0]) throw bad('That cohort code was not found');
      await db.query(`INSERT INTO cohort_members (cohort_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [rows[0].id, req.user!.id]);
      res.json({ cohort: rows[0] });
    }),
  );

  r.use(requireRole('educator', 'admin'));

  r.get(
    '/',
    h(async (req, res) => {
      const isAdmin = req.user!.role === 'admin';
      const { rows } = await db.query(
        `SELECT c.id, c.name, c.join_code, c.is_demo, c.created_at, u.name AS owner_name,
                (SELECT count(*)::int FROM cohort_members m WHERE m.cohort_id = c.id) AS members
           FROM cohorts c JOIN users u ON u.id = c.owner_id
          ${isAdmin ? '' : 'WHERE c.owner_id = $1'}
          ORDER BY c.created_at DESC`,
        isAdmin ? [] : [req.user!.id],
      );
      res.json(
        rows.map((c) => ({
          id: c.id,
          name: c.name,
          joinCode: c.join_code,
          isDemo: c.is_demo,
          ownerName: c.owner_name,
          members: Number(c.members),
          createdAt: new Date(c.created_at).getTime(),
        })),
      );
    }),
  );

  r.post(
    '/',
    h(async (req, res) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
      let code = newJoinCode();
      for (let i = 0; i < 5; i++) {
        const taken = await db.query(`SELECT 1 FROM cohorts WHERE join_code = $1`, [code]);
        if (!taken.rows.length) break;
        code = newJoinCode();
      }
      const { rows } = await db.query(`INSERT INTO cohorts (name, join_code, owner_id) VALUES ($1, $2, $3) RETURNING id`, [
        name,
        code,
        req.user!.id,
      ]);
      await audit(db, req.user!.id, 'cohort.create', { cohortId: rows[0].id, name });
      res.status(201).json({ id: rows[0].id, name, joinCode: code });
    }),
  );

  r.get(
    '/:id',
    h(async (req, res) => {
      const c = await cohortFor(db, req);
      const domain = (z.enum(['lv', 'effusion']).safeParse(req.query.domain).data ?? 'lv') as Domain;
      const members = await db.query(
        `SELECT u.id, u.name, u.email, u.is_simulated, u.persona, m.joined_at
           FROM cohort_members m JOIN users u ON u.id = m.user_id WHERE m.cohort_id = $1 ORDER BY u.name`,
        [c.id],
      );
      const ids = members.rows.map((m) => m.id as string);
      const attempts = await loadAttempts(db, ids);
      const lastReason = await db.query(
        `SELECT DISTINCT ON (user_id) user_id, reason_code FROM decisions WHERE user_id = ANY($1::uuid[]) ORDER BY user_id, created_at DESC`,
        [ids],
      );
      const reasonBy = new Map(lastReason.rows.map((x) => [x.user_id, x.reason_code]));

      const cases = await loadCases(db, { activeOnly: false });
      const byCase = new Map<string, { seeded: number; ab: number; caught: number }>();
      for (const a of attempts) {
        if (a.mode !== 'human-first' || a.aiCorrect !== false) continue;
        const e = byCase.get(a.caseId) ?? { seeded: 0, ab: 0, caught: 0 };
        e.seeded++;
        if (a.outcome === 'automation-bias') e.ab++;
        if (a.outcome === 'caught-error') e.caught++;
        byCase.set(a.caseId, e);
      }
      const caseStats = [...byCase.entries()]
        .map(([id, e]) => {
          const cc = cases.find((x) => x.id === id);
          return {
            caseId: id,
            domain: cc?.domain ?? null,
            errorType: cc?.ai.wrong.errorType ?? null,
            wrongLabel: cc?.options.find((o) => o.value === cc.ai.wrong.answer)?.label ?? null,
            ...e,
          };
        })
        .sort((a, b) => b.ab - a.ab || b.seeded - a.seeded)
        .slice(0, 10);

      const seededHF = attempts.filter((a) => a.mode === 'human-first' && a.aiCorrect === false);
      res.json({
        cohort: { id: c.id, name: c.name, joinCode: c.join_code, isDemo: c.is_demo },
        totals: {
          members: ids.length,
          attempts: attempts.length,
          seededShown: attempts.filter((a) => a.aiShown && a.aiCorrect === false).length,
          caughtRate: seededHF.length ? seededHF.filter((a) => a.outcome === 'caught-error').length / seededHF.length : null,
        },
        rows: members.rows.map((m) => {
          const mine = attempts.filter((a) => a.traineeId === m.id);
          return {
            id: m.id,
            name: m.name,
            simulated: m.is_simulated,
            cases: mine.filter((a) => a.domain === domain).length,
            totalCases: mine.length,
            metrics: computeMetrics(mine, domain),
            lastReason: reasonBy.get(m.id) ?? null,
          };
        }),
        caseStats,
        domains: DOMAINS,
      });
    }),
  );

  r.get(
    '/:id/export.csv',
    h(async (req, res) => {
      const c = await cohortFor(db, req);
      const members = await db.query(`SELECT user_id FROM cohort_members WHERE cohort_id = $1 ORDER BY joined_at`, [c.id]);
      const ids = members.rows.map((m) => m.user_id as string);
      const pseud = new Map(ids.map((id, i) => [id, `T${String(i + 1).padStart(3, '0')}`]));
      const attempts = await loadAttempts(db, ids);
      await audit(db, req.user!.id, 'cohort.export', { cohortId: c.id, rows: attempts.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cortex-${c.join_code}-attempts.csv"`);
      res.send(toCsv(attempts, (id) => pseud.get(id) ?? 'T???'));
    }),
  );

  r.delete(
    '/:id/members/:userId',
    h(async (req, res) => {
      const c = await cohortFor(db, req);
      await db.query(`DELETE FROM cohort_members WHERE cohort_id = $1 AND user_id = $2`, [c.id, req.params.userId]);
      res.json({ ok: true });
    }),
  );

  r.delete(
    '/:id',
    h(async (req, res) => {
      const c = await cohortFor(db, req);
      await db.tx(async (q) => {
        if (c.is_demo) {
          await q.query(
            `DELETE FROM users WHERE is_simulated AND id IN (SELECT user_id FROM cohort_members WHERE cohort_id = $1)`,
            [c.id],
          );
        }
        await q.query(`DELETE FROM cohorts WHERE id = $1`, [c.id]);
        await audit(q, req.user!.id, 'cohort.delete', { cohortId: c.id, name: c.name });
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
