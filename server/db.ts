import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  kind: 'postgres' | 'pglite';
  /** Run several statements without parameters (migrations) */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * DATABASE_URL set → real Postgres (production).
 * Otherwise → PGlite, an embedded Postgres: on disk at dataDir, or in memory for tests.
 */
export async function createDb(opts: { url?: string; dataDir?: string }): Promise<Db> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params as unknown[]) as never,
      exec: async (sql) => {
        await pool.query(sql);
      },
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (s, p) => client.query(s, p as unknown[]) as never });
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const lite = new PGlite(opts.dataDir);
  await lite.waitReady;
  return {
    kind: 'pglite',
    query: (sql, params) => lite.query(sql, params) as never,
    exec: async (sql) => {
      await lite.exec(sql);
    },
    tx: async (fn) => (await lite.transaction((t) => fn({ query: (s, p) => t.query(s, p) as never }))) as never,
    close: () => lite.close(),
  };
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE,
    name text NOT NULL,
    password_hash text,
    role text NOT NULL DEFAULT 'trainee' CHECK (role IN ('trainee','educator','admin')),
    is_simulated boolean NOT NULL DEFAULT false,
    persona text,
    consent_version text,
    consent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE sessions (
    id_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE cohorts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    join_code text UNIQUE NOT NULL,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_demo boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE cohort_members (
    cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cohort_id, user_id)
  );
  CREATE TABLE cases (
    id text PRIMARY KEY,
    pair_id text NOT NULL,
    domain text NOT NULL CHECK (domain IN ('lv','effusion')),
    question text NOT NULL,
    options jsonb NOT NULL,
    answer text NOT NULL,
    difficulty int NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
    rationale text NOT NULL,
    look_for text NOT NULL,
    ai_correct jsonb NOT NULL,
    ai_wrong jsonb NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed')),
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    review_note text,
    active boolean NOT NULL DEFAULT true,
    view_label text NOT NULL DEFAULT 'A4C',
    clip_mime text,
    clip_data bytea,
    clip_source text,
    version int NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE pair_assignments (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pair_id text NOT NULL,
    ai_first_case_id text NOT NULL,
    unaided_case_id text NOT NULL,
    first_half text NOT NULL,
    PRIMARY KEY (user_id, pair_id)
  );
  CREATE TABLE decisions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    domain text NOT NULL,
    mode text NOT NULL,
    case_id text NOT NULL REFERENCES cases(id),
    case_version int NOT NULL,
    ai_wrong boolean NOT NULL,
    error_rate real NOT NULL,
    reason_code text NOT NULL,
    explanation text NOT NULL,
    pair_slot boolean NOT NULL,
    flags jsonb NOT NULL,
    policy_version text NOT NULL,
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','awaiting_final','done')),
    initial_answer text,
    initial_confidence int,
    answered_at timestamptz
  );
  CREATE UNIQUE INDEX decisions_one_open ON decisions(user_id) WHERE state <> 'done';
  CREATE TABLE attempts (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision_id uuid NOT NULL UNIQUE REFERENCES decisions(id) ON DELETE CASCADE,
    case_id text NOT NULL,
    case_version int NOT NULL,
    pair_id text NOT NULL,
    domain text NOT NULL,
    mode text NOT NULL,
    pair_slot boolean NOT NULL,
    ai_shown boolean NOT NULL,
    ai_correct boolean,
    ai_answer text,
    ai_error_type text,
    initial_answer text NOT NULL,
    initial_confidence int NOT NULL,
    final_answer text NOT NULL,
    final_confidence int,
    switched boolean NOT NULL,
    first_correct boolean NOT NULL,
    final_correct boolean NOT NULL,
    outcome text NOT NULL,
    reason_code text NOT NULL,
    reflection text,
    duration_ms int NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX attempts_user ON attempts(user_id, created_at);
  CREATE TABLE audit_log (
    id bigserial PRIMARY KEY,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  `,
];

export async function migrate(db: Db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await db.query<{ version: number }>(`SELECT version FROM schema_migrations`);
  const done = new Set(rows.map((r) => Number(r.version)));
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const v = i + 1;
    if (done.has(v)) continue;
    await db.exec(MIGRATIONS[i]);
    await db.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [v]);
  }
}
