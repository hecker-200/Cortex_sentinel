import path from 'node:path';

export interface Config {
  port: number;
  databaseUrl?: string;
  /** PGlite data folder when DATABASE_URL is not set. Undefined = in-memory. */
  dataDir?: string;
  adminEmail?: string;
  educatorSignupCode?: string;
  production: boolean;
  seedDir: string;
  staticDir: string;
  consentVersion: string;
}

export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.DATABASE_URL ? undefined : env.DATA_DIR ?? path.resolve('.data/pglite'),
    adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    educatorSignupCode: env.EDUCATOR_SIGNUP_CODE || undefined,
    production,
    seedDir: env.SEED_DIR ?? path.resolve('seed'),
    staticDir: env.STATIC_DIR ?? path.resolve('dist'),
    consentVersion: '2026-10-v1',
  };
}
