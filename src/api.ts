import { useCallback, useEffect, useState } from 'react';
import type { Attempt, CaseOption, Domain, Mode, ReasonCode } from './types';
import type { DomainMetrics } from './engine/metrics';
import type { CaseRow } from '../server/repo';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; raw?: Blob; contentType?: string; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'cortex', ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.raw) {
    body = opts.raw;
    headers['Content-Type'] = opts.contentType ?? 'application/octet-stream';
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new ApiError(res.status, (data && typeof data === 'object' && 'error' in data ? String(data.error) : '') || `Request failed (${res.status})`);
  return data as T;
}

/** Fetches on mount and whenever `path` changes. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

// ── Response shapes ─────────────────────────────
export type Role = 'trainee' | 'educator' | 'admin';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  consentVersion: string | null;
}

export interface NextCase {
  decisionId: string;
  caseNumber: number;
  state: 'open' | 'awaiting_final';
  mode: Mode;
  reasonCode: ReasonCode;
  explanation: string;
  flags: { reflection?: boolean; calibrationPrompt?: boolean };
  case: { domain: Domain; question: string; options: CaseOption[]; view: string; clipUrl: string; lookFor?: string };
  ai?: { answer: string; confidence: number };
  initial?: { answer: string; confidence: number };
}

export interface Feedback {
  attempt: Attempt;
  case: { id: string; pairId: string; difficulty: number; status: string; options: CaseOption[]; answer: string };
  rationale: string;
  lookFor: string;
  ai: { answer: string; confidence: number; correct: boolean } | null;
  reflectionPrompt: boolean;
  reflectionOptions: string[];
}

export interface Summary {
  total: number;
  metrics: Record<Domain, DomainMetrics>;
  decisions: { id: string; at: number; caseId: string | null; mode: Mode; reasonCode: ReasonCode; explanation: string; outcome: Attempt['outcome'] | null }[];
  cohorts: { id: string; name: string }[];
}

export interface CohortListItem {
  id: string;
  name: string;
  joinCode: string;
  isDemo: boolean;
  ownerName: string;
  members: number;
  createdAt: number;
}

export interface CohortDetail {
  cohort: { id: string; name: string; joinCode: string; isDemo: boolean };
  totals: { members: number; attempts: number; seededShown: number; caughtRate: number | null };
  rows: { id: string; name: string; simulated: boolean; cases: number; totalCases: number; metrics: DomainMetrics; lastReason: ReasonCode | null }[];
  caseStats: { caseId: string; domain: Domain | null; errorType: string | null; wrongLabel: string | null; seeded: number; ab: number; caught: number }[];
}

export type AdminCase = CaseRow;

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  attempts: number;
  createdAt: number;
  consented: boolean;
}

export interface PolicyCheck {
  key: string;
  name: string;
  description: string;
  expected: ReasonCode | null;
  passed: boolean | null;
  firstFiredAt: number | null;
  rulesFired: ReasonCode[];
}

export interface AuditEntry {
  id: number;
  action: string;
  detail: Record<string, unknown>;
  at: number;
  userName: string | null;
}
