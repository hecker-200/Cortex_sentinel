import { Router } from 'express';
import { z } from 'zod';
import { checkPassword, createSession, destroySession, hashPassword, rateLimit, setSessionCookie, COOKIE, type Role } from '../auth';
import type { Config } from '../config';
import type { Db } from '../db';
import { HttpError, bad, h } from '../http';
import { audit } from '../repo';

const Email = z.string().trim().toLowerCase().email().max(200);

export function authRoutes(db: Db, cfg: Config) {
  const r = Router();
  const secure = (req: { secure: boolean }) => cfg.production || req.secure;

  r.post(
    '/signup',
    h(async (req, res) => {
      rateLimit(`signup:${req.ip}`, 20, 60 * 60_000);
      const body = z
        .object({
          name: z.string().trim().min(1).max(80),
          email: Email,
          password: z.string().min(8, 'must be at least 8 characters').max(200),
          joinCode: z.string().trim().toUpperCase().max(12).optional().or(z.literal('')),
          educatorCode: z.string().max(100).optional().or(z.literal('')),
        })
        .parse(req.body);

      const exists = await db.query(`SELECT 1 FROM users WHERE email = $1`, [body.email]);
      if (exists.rows.length) throw bad('An account with this email already exists. Sign in instead.');

      let cohortId: string | null = null;
      if (body.joinCode) {
        const c = await db.query(`SELECT id FROM cohorts WHERE join_code = $1`, [body.joinCode]);
        if (!c.rows[0]) throw bad('That cohort code was not found. Check it with your educator, or leave it blank.');
        cohortId = c.rows[0].id;
      }

      const anyHuman = await db.query(`SELECT 1 FROM users WHERE NOT is_simulated LIMIT 1`);
      let role: Role = 'trainee';
      if (!anyHuman.rows.length || (cfg.adminEmail && cfg.adminEmail === body.email)) role = 'admin';
      else if (body.educatorCode) {
        if (!cfg.educatorSignupCode || body.educatorCode !== cfg.educatorSignupCode) throw bad('The educator code is not valid');
        role = 'educator';
      }

      const hash = await hashPassword(body.password);
      const { rows } = await db.query(
        `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [body.email, body.name, hash, role],
      );
      const userId = rows[0].id as string;
      if (cohortId) await db.query(`INSERT INTO cohort_members (cohort_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [cohortId, userId]);
      await audit(db, userId, 'user.signup', { role });
      setSessionCookie(res, await createSession(db, userId), secure(req));
      res.status(201).json({ user: { id: userId, name: body.name, email: body.email, role, consentVersion: null } });
    }),
  );

  r.post(
    '/login',
    h(async (req, res) => {
      const body = z.object({ email: Email, password: z.string().min(1).max(200) }).parse(req.body);
      rateLimit(`login:${req.ip}:${body.email}`, 10, 15 * 60_000);
      const { rows } = await db.query(
        `SELECT id, name, email, role, password_hash, consent_version FROM users WHERE email = $1 AND NOT is_simulated`,
        [body.email],
      );
      const u = rows[0];
      if (!u || !u.password_hash || !(await checkPassword(body.password, u.password_hash))) {
        throw new HttpError(401, 'Email or password is incorrect');
      }
      setSessionCookie(res, await createSession(db, u.id), secure(req));
      res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, consentVersion: u.consent_version } });
    }),
  );

  r.post(
    '/logout',
    h(async (req, res) => {
      await destroySession(db, req);
      res.clearCookie(COOKIE, { path: '/' });
      res.json({ ok: true });
    }),
  );

  r.get(
    '/me',
    h(async (req, res) => {
      if (!req.user) throw new HttpError(401, 'Not signed in');
      res.json({ user: req.user, consentRequired: cfg.consentVersion, educatorSignupEnabled: Boolean(cfg.educatorSignupCode) });
    }),
  );

  r.get(
    '/config',
    h(async (_req, res) => {
      res.json({ educatorSignupEnabled: Boolean(cfg.educatorSignupCode), consentVersion: cfg.consentVersion });
    }),
  );

  return r;
}
