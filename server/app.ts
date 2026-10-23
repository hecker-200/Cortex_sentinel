import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { csrfGuard, sessionMiddleware } from './auth';
import type { Config } from './config';
import type { Db } from './db';
import { errorHandler } from './http';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { cohortRoutes } from './routes/cohorts';
import { meRoutes, practiceRoutes } from './routes/practice';

export function createApp(db: Db, cfg: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });

  app.get('/healthz', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true, db: db.kind });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use(sessionMiddleware(db));
  api.use(csrfGuard);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use('/auth', authRoutes(db, cfg));
  api.use('/me', meRoutes(db, cfg));
  api.use('/practice', practiceRoutes(db, cfg));
  api.use('/cohorts', cohortRoutes(db));
  api.use('/admin', adminRoutes(db));
  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  api.use(errorHandler);
  app.use('/api', api);

  // Built frontend
  if (existsSync(cfg.staticDir)) {
    app.use(express.static(cfg.staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(cfg.staticDir, 'index.html')));
  }
  return app;
}
