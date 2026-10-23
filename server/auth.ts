import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db';
import { HttpError, ms } from './http';

export type Role = 'trainee' | 'educator' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  consentVersion: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const COOKIE = 'cortex_sid';
const SESSION_DAYS = 30;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [
    sha(token),
    userId,
  ]);
  return token;
}

export function setSessionCookie(res: Response, token: string, secure: boolean) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_DAYS * 86_400_000,
    path: '/',
  });
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export async function destroySession(db: Db, req: Request) {
  const token = readCookie(req, COOKIE);
  if (token) await db.query(`DELETE FROM sessions WHERE id_hash = $1`, [sha(token)]);
}

/** Attaches req.user when a valid session cookie is present. */
export const sessionMiddleware = (db: Db) => async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = readCookie(req, COOKIE);
    if (token) {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.name, u.role, u.consent_version, s.expires_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id_hash = $1`,
        [sha(token)],
      );
      const r = rows[0];
      if (r && ms(r.expires_at) > Date.now()) {
        req.user = { id: r.id, email: r.email, name: r.name, role: r.role, consentVersion: r.consent_version };
      }
    }
    next();
  } catch (e) {
    next(e);
  }
};

export const requireUser = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
};

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Your account does not have access to this'));
    next();
  };

/** Blocks cross-site form posts: every state-changing API call must send this header. */
export const csrfGuard = (req: Request, _res: Response, next: NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'cortex') return next(new HttpError(403, 'Missing request header'));
  next();
};

// Simple in-memory limiter for login and signup
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  e.n++;
  if (e.n > max) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}
