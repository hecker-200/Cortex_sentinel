import { describe, expect, it } from 'vitest';
import rawCases from '../../seed/cases.json';
import type { Attempt, CaseItem } from '../types';
import { makeAttempt } from './attempt';
import { classify } from './outcome';
import { computeMetrics } from './metrics';
import { decideNext } from './policy';
import { PERSONAS, runPersonaChecks, simulateTrainee } from './simulate';

const cases = rawCases as CaseItem[];

describe('case bank', () => {
  it('has 12 matched pairs with equal answer and difficulty', () => {
    const byPair = new Map<string, CaseItem[]>();
    for (const c of cases) byPair.set(c.pairId, [...(byPair.get(c.pairId) ?? []), c]);
    expect(byPair.size).toBe(12);
    for (const [, pair] of byPair) {
      expect(pair).toHaveLength(2);
      expect(pair[0].answer).toBe(pair[1].answer);
      expect(pair[0].difficulty).toBe(pair[1].difficulty);
    }
  });
  it('every wrong AI output is actually wrong and every correct one is right', () => {
    for (const c of cases) {
      expect(c.ai.wrong.answer).not.toBe(c.answer);
      expect(c.ai.correct.answer).toBe(c.answer);
      expect(c.options.map((o) => o.value)).toContain(c.ai.wrong.answer);
    }
  });
});

describe('reliance matrix', () => {
  it('classifies all six human-first outcomes', () => {
    expect(classify('human-first', false, true, true)).toBe('caught-error');
    expect(classify('human-first', false, true, false)).toBe('automation-bias');
    expect(classify('human-first', false, false, false)).toBe('missed-error');
    expect(classify('human-first', true, true, true)).toBe('aligned');
    expect(classify('human-first', true, false, true)).toBe('appropriate-reliance');
    expect(classify('human-first', true, false, false)).toBe('under-reliance');
  });
  it('classifies the other modes', () => {
    expect(classify('ai-first', true, true, true)).toBe('assisted-correct');
    expect(classify('unaided', null, false, false)).toBe('unaided-incorrect');
    expect(classify('guided', null, true, true)).toBe('unaided-correct');
  });
});

describe('policy', () => {
  it('starts with a human-first baseline (R1) and never repeats the previous case', () => {
    const sim = simulateTrainee(PERSONAS[0], cases, 12, 'r1', 0);
    expect(sim.decisions.every((d) => d.reasonCode === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(sim.decisions.every((d) => d.mode === 'human-first')).toBe(true);
    for (let i = 1; i < sim.attempts.length; i++) expect(sim.attempts[i].caseId).not.toBe(sim.attempts[i - 1].caseId);
  });
  it('is deterministic for the same trainee history', () => {
    const a = decideNext({ traineeId: 't1', attempts: [], cases, pairs: {}, now: 0 }).decision;
    const b = decideNext({ traineeId: 't1', attempts: [], cases, pairs: {}, now: 0 }).decision;
    expect({ ...a, id: '' }).toEqual({ ...b, id: '' });
  });
  it('gives every decision a reason code and explanation', () => {
    const sim = simulateTrainee(PERSONAS[1], cases, 40, 'codes', 0);
    for (const d of sim.decisions) {
      expect(d.reasonCode).toBeTruthy();
      expect(d.explanation.length).toBeGreaterThan(10);
    }
  });
  it('seeds AI errors at roughly the configured rate', () => {
    let shown = 0;
    let wrong = 0;
    for (const p of PERSONAS) {
      const sim = simulateTrainee(p, cases, 60, 'rate', 0);
      for (const d of sim.decisions) if (d.mode === 'human-first' || d.mode === 'ai-first') {
        shown++;
        if (d.aiWrong) wrong++;
      }
    }
    const rate = wrong / shown;
    expect(rate).toBeGreaterThan(0.18);
    expect(rate).toBeLessThan(0.42);
  });
  it('completes matched pairs with one AI-first and one unaided half', () => {
    const sim = simulateTrainee(PERSONAS[4], cases, 80, 'pairs', 0);
    const m = computeMetrics(sim.attempts, 'lv');
    expect(m.gap.n).toBeGreaterThan(0);
    for (const p of Object.values(sim.pairs)) expect(p.aiFirstCaseId).not.toBe(p.unaidedCaseId);
  });
});

describe('persona acceptance checks', () => {
  const checks = runPersonaChecks(cases, 40);
  it('does not unlock AI-first for a trainee who keeps rejecting correct AI answers', () => {
    // Strong record in both domains, plus repeated under-reliance in LV
    const attempts: Attempt[] = [];
    let i = 0;
    const add = (c: CaseItem, aiWrong: boolean, first: string, final: string) => {
      const decision = {
        id: `d${i}`, traineeId: 'u', at: i, domain: c.domain, mode: 'human-first' as const, caseId: c.id,
        aiWrong, errorRate: 0.25, reasonCode: 'DEFAULT_SCHEDULE' as const, explanation: 'test',
        pairSlot: false, flags: {}, policyVersion: 'test',
      };
      attempts.push(makeAttempt({ decision, c, initialAnswer: first, initialConfidence: 3, finalAnswer: final, finalConfidence: 3, durationMs: 1, now: i++ }));
    };
    for (const d of ['lv', 'effusion'] as const) {
      const pool = cases.filter((c) => c.domain === d);
      for (let k = 0; k < 12; k++) add(pool[k % pool.length], k % 3 === 0, pool[k % pool.length].answer, pool[k % pool.length].answer);
    }
    const lv = cases.filter((c) => c.domain === 'lv');
    for (let k = 0; k < 3; k++) {
      const c = lv[k];
      const wrong = c.options.find((o) => o.value !== c.answer)!.value;
      add(c, false, wrong, wrong); // AI right, trainee kept a wrong read
    }
    const m = computeMetrics(attempts, 'lv');
    expect(m.underReliance.value).toBe(1);
    const next = decideNext({ traineeId: 'u', attempts, cases, pairs: {}, now: 0 }).decision;
    if (next.domain === 'lv') expect(next.reasonCode).not.toBe('VERIFIED_INDEPENDENCE');
    const lvOnly = decideNext({ traineeId: 'u', attempts: [...attempts, ...attempts.filter((a) => a.domain === 'effusion')], cases, pairs: {}, now: 0 }).decision;
    expect(lvOnly.domain).toBe('lv');
    expect(lvOnly.reasonCode).not.toBe('VERIFIED_INDEPENDENCE');
  });
  for (const ch of checks.filter((c) => c.persona.expected)) {
    it(`${ch.persona.name} triggers ${ch.persona.expected}`, () => {
      expect(ch.rulesFired).toContain(ch.persona.expected);
    });
  }
});
