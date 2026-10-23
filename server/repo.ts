import type { Attempt, CaseItem, PairAssignment, PolicyDecision } from '../src/types';
import type { Queryable } from './db';
import { ms } from './http';

/* eslint-disable @typescript-eslint/no-explicit-any */

const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

export interface CaseRow extends CaseItem {
  version: number;
  active: boolean;
  viewLabel: string;
  hasClip: boolean;
  clipSource: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: number | null;
  reviewNote: string | null;
  updatedAt: number;
}

export function rowToCase(r: any): CaseRow {
  return {
    id: r.id,
    pairId: r.pair_id,
    domain: r.domain,
    question: r.question,
    options: json(r.options),
    answer: r.answer,
    difficulty: r.difficulty,
    rationale: r.rationale,
    lookFor: r.look_for,
    ai: { correct: json(r.ai_correct), wrong: json(r.ai_wrong) },
    status: r.status,
    clip: { kind: 'video', src: `/api/admin/cases/${encodeURIComponent(r.id)}/clip?v=${r.version}`, view: r.view_label },
    version: r.version,
    active: r.active,
    viewLabel: r.view_label,
    hasClip: Boolean(r.has_clip),
    clipSource: r.clip_source ?? null,
    reviewedBy: r.reviewed_by ?? null,
    reviewedByName: r.reviewer_name ?? null,
    reviewedAt: r.reviewed_at ? ms(r.reviewed_at) : null,
    reviewNote: r.review_note ?? null,
    updatedAt: ms(r.updated_at),
  };
}

const CASE_COLS = `c.id, c.pair_id, c.domain, c.question, c.options, c.answer, c.difficulty, c.rationale, c.look_for,
  c.ai_correct, c.ai_wrong, c.status, c.reviewed_by, c.reviewed_at, c.review_note, c.active, c.view_label,
  c.clip_source, c.version, c.updated_at, (c.clip_data IS NOT NULL) AS has_clip, u.name AS reviewer_name`;

export async function loadCases(q: Queryable, opts: { activeOnly: boolean }): Promise<CaseRow[]> {
  const { rows } = await q.query(
    `SELECT ${CASE_COLS} FROM cases c LEFT JOIN users u ON u.id = c.reviewed_by
      ${opts.activeOnly ? 'WHERE c.active AND c.clip_data IS NOT NULL' : ''}
      ORDER BY c.domain, c.pair_id, c.id`,
  );
  return rows.map(rowToCase);
}

export async function loadCase(q: Queryable, id: string): Promise<CaseRow | null> {
  const { rows } = await q.query(`SELECT ${CASE_COLS} FROM cases c LEFT JOIN users u ON u.id = c.reviewed_by WHERE c.id = $1`, [id]);
  return rows[0] ? rowToCase(rows[0]) : null;
}

export function rowToAttempt(r: any): Attempt {
  return {
    id: r.id,
    traineeId: r.user_id,
    decisionId: r.decision_id,
    caseId: r.case_id,
    pairId: r.pair_id,
    domain: r.domain,
    mode: r.mode,
    pairSlot: r.pair_slot,
    aiShown: r.ai_shown,
    aiCorrect: r.ai_correct,
    aiAnswer: r.ai_answer,
    aiErrorType: r.ai_error_type,
    initialAnswer: r.initial_answer,
    initialConfidence: r.initial_confidence,
    finalAnswer: r.final_answer,
    finalConfidence: r.final_confidence,
    switched: r.switched,
    firstCorrect: r.first_correct,
    finalCorrect: r.final_correct,
    outcome: r.outcome,
    reasonCode: r.reason_code,
    reflection: r.reflection ?? undefined,
    durationMs: r.duration_ms,
    createdAt: ms(r.created_at),
  };
}

export async function loadAttempts(q: Queryable, userIds: string[]): Promise<Attempt[]> {
  if (!userIds.length) return [];
  const { rows } = await q.query(`SELECT * FROM attempts WHERE user_id = ANY($1::uuid[]) ORDER BY created_at, id`, [userIds]);
  return rows.map(rowToAttempt);
}

export async function insertAttempt(q: Queryable, a: Attempt, caseVersion: number) {
  await q.query(
    `INSERT INTO attempts (id, user_id, decision_id, case_id, case_version, pair_id, domain, mode, pair_slot, ai_shown, ai_correct,
       ai_answer, ai_error_type, initial_answer, initial_confidence, final_answer, final_confidence, switched, first_correct,
       final_correct, outcome, reason_code, reflection, duration_ms, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
    [
      a.id, a.traineeId, a.decisionId, a.caseId, caseVersion, a.pairId, a.domain, a.mode, a.pairSlot, a.aiShown, a.aiCorrect,
      a.aiAnswer, a.aiErrorType, a.initialAnswer, a.initialConfidence, a.finalAnswer, a.finalConfidence, a.switched,
      a.firstCorrect, a.finalCorrect, a.outcome, a.reasonCode, a.reflection ?? null, Math.round(a.durationMs),
      new Date(a.createdAt),
    ],
  );
}

export async function loadPairs(q: Queryable, userId: string): Promise<Record<string, PairAssignment>> {
  const { rows } = await q.query(`SELECT * FROM pair_assignments WHERE user_id = $1`, [userId]);
  return Object.fromEntries(
    rows.map((r: any) => [
      r.pair_id,
      { pairId: r.pair_id, aiFirstCaseId: r.ai_first_case_id, unaidedCaseId: r.unaided_case_id, firstHalf: r.first_half },
    ]),
  );
}

export async function insertPair(q: Queryable, userId: string, p: PairAssignment) {
  await q.query(
    `INSERT INTO pair_assignments (user_id, pair_id, ai_first_case_id, unaided_case_id, first_half) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, pair_id) DO NOTHING`,
    [userId, p.pairId, p.aiFirstCaseId, p.unaidedCaseId, p.firstHalf],
  );
}

export interface DecisionRow extends PolicyDecision {
  caseVersion: number;
  state: 'open' | 'awaiting_final' | 'done';
  initialAnswer: string | null;
  initialConfidence: number | null;
  createdAt: number;
}

export function rowToDecision(r: any): DecisionRow {
  return {
    id: r.id,
    traineeId: r.user_id,
    at: ms(r.created_at),
    domain: r.domain,
    mode: r.mode,
    caseId: r.case_id,
    aiWrong: r.ai_wrong,
    errorRate: Number(r.error_rate),
    reasonCode: r.reason_code,
    explanation: r.explanation,
    pairSlot: r.pair_slot,
    flags: json(r.flags) ?? {},
    policyVersion: r.policy_version,
    caseVersion: r.case_version,
    state: r.state,
    initialAnswer: r.initial_answer,
    initialConfidence: r.initial_confidence,
    createdAt: ms(r.created_at),
  };
}

export async function insertDecision(q: Queryable, d: PolicyDecision, caseVersion: number, at?: Date, state: 'open' | 'done' = 'open') {
  await q.query(
    `INSERT INTO decisions (id, user_id, created_at, domain, mode, case_id, case_version, ai_wrong, error_rate, reason_code,
       explanation, pair_slot, flags, policy_version, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
    [
      d.id, d.traineeId, at ?? new Date(), d.domain, d.mode, d.caseId, caseVersion, d.aiWrong, d.errorRate, d.reasonCode,
      d.explanation, d.pairSlot, JSON.stringify(d.flags ?? {}), d.policyVersion, state,
    ],
  );
}

export async function audit(q: Queryable, userId: string | null, action: string, detail: Record<string, unknown> = {}) {
  await q.query(`INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3::jsonb)`, [userId, action, JSON.stringify(detail)]);
}
