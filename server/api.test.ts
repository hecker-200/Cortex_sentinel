import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb, migrate, type Db } from './db';
import { seedCases } from './seed';

let db: Db;
let app: ReturnType<typeof createApp>;
const cfg = {
  ...loadConfig({ NODE_ENV: 'test', EDUCATOR_SIGNUP_CODE: 'teach-123' } as NodeJS.ProcessEnv),
  dataDir: undefined,
  seedDir: path.resolve('seed'),
  staticDir: '/nonexistent',
};

const H = { 'X-Requested-With': 'cortex' };

async function signup(name: string, email: string, extra: Record<string, string> = {}) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').set(H).send({ name, email, password: 'correct horse', ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { agent, user: res.body.user };
}

// Set TEST_DATABASE_URL to run against a real Postgres (the schema is wiped first)
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  db = await createDb(url ? { url } : {});
  if (url) await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  const n = await seedCases(db, cfg.seedDir);
  expect(n).toBe(24);
  app = createApp(db, cfg);
}, 60000);

afterAll(async () => {
  await db.close();
});

describe('accounts', () => {
  it('makes the first account an admin and later ones trainees', async () => {
    const a = await signup('Admin One', 'admin@example.com');
    expect(a.user.role).toBe('admin');
    const t = await signup('Trainee One', 'trainee1@example.com');
    expect(t.user.role).toBe('trainee');
  });

  it('rejects duplicate email, bad password and missing CSRF header', async () => {
    const dup = await request(app).post('/api/auth/signup').set(H).send({ name: 'X', email: 'TRAINEE1@example.com', password: 'whatever123' });
    expect(dup.status).toBe(400);
    const bad = await request(app).post('/api/auth/login').set(H).send({ email: 'trainee1@example.com', password: 'nope' });
    expect(bad.status).toBe(401);
    const noHeader = await request(app).post('/api/auth/login').send({ email: 'trainee1@example.com', password: 'correct horse' });
    expect(noHeader.status).toBe(403);
  });

  it('creates educators only with the educator code', async () => {
    const wrong = await request(app).post('/api/auth/signup').set(H).send({ name: 'E', email: 'e0@example.com', password: 'password1', educatorCode: 'guess' });
    expect(wrong.status).toBe(400);
    const e = await signup('Educator', 'edu@example.com', { educatorCode: 'teach-123' });
    expect(e.user.role).toBe('educator');
  });

  it('signs in, reports the user, and signs out', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').set(H).send({ email: 'trainee1@example.com', password: 'correct horse' });
    expect(login.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('trainee1@example.com');
    await agent.post('/api/auth/logout').set(H);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('practice loop', () => {
  it('requires consent before practice', async () => {
    const { agent } = await signup('No Consent', 'nc@example.com');
    const r = await agent.get('/api/practice/next');
    expect(r.status).toBe(412);
  });

  it('never sends the answer, AI read, case ID or rationale before a human-first answer', async () => {
    const { agent } = await signup('Leak Check', 'leak@example.com');
    await agent.post('/api/me/consent').set(H).send({ version: cfg.consentVersion });
    const r = await agent.get('/api/practice/next');
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('human-first');
    const text = JSON.stringify(r.body);
    expect(r.body.ai).toBeUndefined();
    expect(text).not.toMatch(/LV-\d|PE-\d/);
    expect(text).not.toContain('rationale');
    expect(text).not.toContain('"answer"');
    expect(r.body.case.clipUrl).toBe(`/api/practice/${r.body.decisionId}/clip`);

    // Same case again on reload
    const again = await agent.get('/api/practice/next');
    expect(again.body.decisionId).toBe(r.body.decisionId);

    // Clip streams, including byte ranges
    const clip = await agent.get(r.body.case.clipUrl).buffer(true);
    expect(clip.status).toBe(200);
    expect(clip.headers['content-type']).toBe('video/mp4');
    const part = await agent.get(r.body.case.clipUrl).set('Range', 'bytes=0-99');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-99\//);
  });

  it('gives two simultaneous requests the same case', async () => {
    const { agent } = await signup('Two Tabs', 'tabs@example.com');
    await agent.post('/api/me/consent').set(H).send({ version: cfg.consentVersion });
    const [a, b] = await Promise.all([agent.get('/api/practice/next'), agent.get('/api/practice/next')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.decisionId).toBe(b.body.decisionId);
  });

  it('runs 15 full cases and records outcomes and metrics', async () => {
    const { agent } = await signup('Runner', 'runner@example.com');
    await agent.post('/api/me/consent').set(H).send({ version: cfg.consentVersion });
    const outcomes: string[] = [];
    for (let i = 0; i < 15; i++) {
      const n = await agent.get('/api/practice/next');
      expect(n.status).toBe(200);
      expect(n.body.caseNumber).toBe(i + 1);
      const first = n.body.case.options[0].value;
      const a = await agent.post(`/api/practice/${n.body.decisionId}/answer`).set(H).send({ answer: first, confidence: 4 });
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      let fb = a.body.feedback;
      if (a.body.state === 'awaiting_final') {
        expect(a.body.ai.answer).toBeTruthy();
        const f = await agent.post(`/api/practice/${n.body.decisionId}/final`).set(H).send({ choice: i % 2 ? 'ai' : 'keep', confidence: 3 });
        expect(f.status).toBe(200);
        fb = f.body.feedback;
      }
      expect(fb.rationale.length).toBeGreaterThan(10);
      expect(fb.case.id).toMatch(/^(LV|PE)-/);
      outcomes.push(fb.attempt.outcome);
      // Answering twice is refused
      const twice = await agent.post(`/api/practice/${n.body.decisionId}/answer`).set(H).send({ answer: first, confidence: 4 });
      expect(twice.status).toBe(409);
    }
    const s = await agent.get('/api/me/summary');
    expect(s.body.total).toBe(15);
    expect(s.body.metrics.lv.total + s.body.metrics.effusion.total).toBe(15);
    expect(outcomes.length).toBe(15);
  });

  it('rejects an answer that is not an option, and another user’s case', async () => {
    const a = await signup('Owner', 'owner@example.com');
    await a.agent.post('/api/me/consent').set(H).send({ version: cfg.consentVersion });
    const n = await a.agent.get('/api/practice/next');
    const badAns = await a.agent.post(`/api/practice/${n.body.decisionId}/answer`).set(H).send({ answer: 'banana', confidence: 3 });
    expect(badAns.status).toBe(400);
    const b = await signup('Intruder', 'intruder@example.com');
    await b.agent.post('/api/me/consent').set(H).send({ version: cfg.consentVersion });
    const steal = await b.agent.post(`/api/practice/${n.body.decisionId}/answer`).set(H).send({ answer: n.body.case.options[0].value, confidence: 3 });
    expect(steal.status).toBe(404);
    const clip = await b.agent.get(n.body.case.clipUrl);
    expect(clip.status).toBe(404);
  });
});

describe('cohorts and educator view', () => {
  it('lets an educator create a cohort, trainees join, and export CSV; trainees are blocked', async () => {
    const edu = request.agent(app);
    await edu.post('/api/auth/login').set(H).send({ email: 'edu@example.com', password: 'correct horse' });
    const c = await edu.post('/api/cohorts').set(H).send({ name: 'EM residents 2026' });
    expect(c.status).toBe(201);
    expect(c.body.joinCode).toMatch(/^[A-Z2-9]{6}$/);

    const runner = request.agent(app);
    await runner.post('/api/auth/login').set(H).send({ email: 'runner@example.com', password: 'correct horse' });
    expect((await runner.post('/api/cohorts/join').set(H).send({ code: c.body.joinCode.toLowerCase() })).status).toBe(200);
    expect((await runner.get(`/api/cohorts/${c.body.id}`)).status).toBe(403);

    const detail = await edu.get(`/api/cohorts/${c.body.id}?domain=lv`);
    expect(detail.status).toBe(200);
    expect(detail.body.rows).toHaveLength(1);
    expect(detail.body.totals.attempts).toBe(15);

    const csv = await edu.get(`/api/cohorts/${c.body.id}/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text.split('\n')[0]).toMatch(/^trainee,caseId/);
    expect(csv.text).not.toContain('runner@example.com');
    expect(csv.text.trim().split('\n')).toHaveLength(16);
  });

  it('builds a demo cohort of simulated trainees', async () => {
    const edu = request.agent(app);
    await edu.post('/api/auth/login').set(H).send({ email: 'edu@example.com', password: 'correct horse' });
    const d = await edu.post('/api/admin/demo-cohort').set(H);
    expect(d.status).toBe(201);
    const detail = await edu.get(`/api/cohorts/${d.body.id}`);
    expect(detail.body.rows).toHaveLength(5);
    expect(detail.body.totals.attempts).toBe(200);
    const del = await edu.delete(`/api/cohorts/${d.body.id}`).set(H);
    expect(del.status).toBe(200);
  });
});

describe('admin case management', () => {
  it('edits a case (back to draft), signs it off, and uploads a clip', async () => {
    const admin = request.agent(app);
    await admin.post('/api/auth/login').set(H).send({ email: 'admin@example.com', password: 'correct horse' });
    const list = await admin.get('/api/admin/cases');
    expect(list.body).toHaveLength(24);
    const c = list.body[0];
    expect(c.hasClip).toBe(true);

    const signed = await admin.post(`/api/admin/cases/${c.id}/review`).set(H).send({ status: 'reviewed', note: 'Looks right' });
    expect(signed.body.status).toBe('reviewed');
    expect(signed.body.reviewedByName).toBe('Admin One');

    const body = {
      pairId: c.pairId, domain: c.domain, question: c.question, options: c.options, answer: c.answer, difficulty: c.difficulty,
      rationale: c.rationale + ' Edited.', lookFor: c.lookFor, aiCorrect: c.ai.correct, aiWrong: c.ai.wrong, viewLabel: c.viewLabel, active: true,
    };
    const edited = await admin.put(`/api/admin/cases/${c.id}`).set(H).send(body);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.status).toBe('draft');
    expect(edited.body.version).toBe(c.version + 1);

    const badWrong = await admin.put(`/api/admin/cases/${c.id}`).set(H).send({ ...body, aiWrong: { ...c.ai.wrong, answer: c.answer } });
    expect(badWrong.status).toBe(400);

    const clip = Buffer.alloc(5000, 1);
    const up = await admin.put(`/api/admin/cases/${c.id}/clip`).set(H).set('Content-Type', 'video/mp4').send(clip);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const got = await admin.get(`/api/admin/cases/${c.id}/clip`);
    expect(got.body.length ?? got.text.length).toBe(5000);

    const audit = await admin.get('/api/admin/audit');
    expect(audit.body.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['case.signoff', 'case.update', 'case.clip']));
  });

  it('lets users change their password and admins issue a temporary one', async () => {
    const t = request.agent(app);
    await t.post('/api/auth/login').set(H).send({ email: 'trainee1@example.com', password: 'correct horse' });
    expect((await t.post('/api/me/password').set(H).send({ current: 'wrong', next: 'new password 1' })).status).toBe(400);
    expect((await t.post('/api/me/password').set(H).send({ current: 'correct horse', next: 'new password 1' })).status).toBe(200);
    const admin = request.agent(app);
    await admin.post('/api/auth/login').set(H).send({ email: 'admin@example.com', password: 'correct horse' });
    const users = await admin.get('/api/admin/users');
    const id = users.body.find((u: { email: string }) => u.email === 'trainee1@example.com').id;
    const tmp = await admin.post(`/api/admin/users/${id}/temp-password`).set(H);
    expect(tmp.body.tempPassword.length).toBeGreaterThanOrEqual(10);
    expect((await t.get('/api/auth/me')).status).toBe(401); // old session ended
    const relog = await request(app).post('/api/auth/login').set(H).send({ email: 'trainee1@example.com', password: tmp.body.tempPassword });
    expect(relog.status).toBe(200);
    await request.agent(app).post('/api/auth/login').set(H).send({ email: 'trainee1@example.com', password: tmp.body.tempPassword });
  });

  it('blocks trainees from admin routes', async () => {
    const t = request.agent(app);
    await t.post('/api/auth/login').set(H).send({ email: 'runner@example.com', password: 'correct horse' });
    expect((await t.get('/api/admin/cases')).status).toBe(403);
    expect((await t.get('/api/admin/users')).status).toBe(403);
  });

  it('runs the persona policy checks on live cases', async () => {
    const admin = request.agent(app);
    await admin.post('/api/auth/login').set(H).send({ email: 'admin@example.com', password: 'correct horse' });
    const r = await admin.get('/api/admin/policy-checks');
    expect(r.status).toBe(200);
    for (const p of r.body) if (p.expected) expect(p.passed).toBe(true);
  });
});
