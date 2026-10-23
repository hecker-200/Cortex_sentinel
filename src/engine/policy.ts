import type { Attempt, CaseItem, Domain, Mode, PairAssignment, PolicyDecision, ReasonCode } from '../types';
import { CONFIG, DOMAINS, DOMAIN_LABEL, POLICY_VERSION } from './config';
import { computeMetrics, pct } from './metrics';
import { rngFor, uid } from './rng';

export interface PolicyInput {
  traineeId: string;
  /** This trainee's attempts, oldest first */
  attempts: Attempt[];
  cases: CaseItem[];
  /** This trainee's matched-pair assignments, keyed by pairId */
  pairs: Record<string, PairAssignment>;
  now?: number;
}

export interface PolicyResult {
  decision: PolicyDecision;
  newPair?: PairAssignment;
}

/**
 * Deterministic, explainable policy. Rules run in order and the first match wins.
 * R1–R4 are corrective and can target any domain; R5–R6 apply to the domain
 * with the fewest attempts so both domains keep getting practice.
 */
export function decideNext(input: PolicyInput): PolicyResult {
  const { traineeId, attempts, cases, pairs } = input;
  const rand = rngFor(traineeId, attempts.length, 'policy');
  const inDomain = (d: Domain) => attempts.filter((a) => a.domain === d);
  const label = (d: Domain) => DOMAIN_LABEL[d];
  const lastCaseId = attempts.length ? attempts[attempts.length - 1].caseId : null;
  // Only domains that currently have active cases take part
  const DOMS = DOMAINS.filter((d) => cases.some((c) => c.domain === d));
  if (!DOMS.length) throw new Error('No active cases');

  const seen = new Map<string, number>();
  for (const a of attempts) seen.set(a.caseId, (seen.get(a.caseId) ?? 0) + 1);

  const pickCase = (d: Domain): CaseItem => {
    let pool = cases.filter((c) => c.domain === d && c.id !== lastCaseId);
    if (!pool.length) pool = cases.filter((c) => c.domain === d);
    const min = Math.min(...pool.map((c) => seen.get(c.id) ?? 0));
    const least = pool.filter((c) => (seen.get(c.id) ?? 0) === min);
    return least[Math.floor(rand() * least.length)];
  };

  const build = (p: {
    domain: Domain;
    mode: Mode;
    errorRate: number;
    reasonCode: ReasonCode;
    explanation: string;
    caseId?: string;
    pairSlot?: boolean;
    flags?: PolicyDecision['flags'];
  }): PolicyDecision => {
    const caseId = p.caseId ?? pickCase(p.domain).id;
    const hasAI = p.mode === 'human-first' || p.mode === 'ai-first';
    return {
      id: uid('d_'),
      traineeId,
      at: input.now ?? Date.now(),
      domain: p.domain,
      mode: p.mode,
      caseId,
      aiWrong: hasAI ? rand() < p.errorRate : false,
      errorRate: hasAI ? p.errorRate : 0,
      reasonCode: p.reasonCode,
      explanation: p.explanation,
      pairSlot: p.pairSlot ?? false,
      flags: p.flags ?? {},
      policyVersion: POLICY_VERSION,
    };
  };

  // R1: build a human-first baseline in every domain
  const under = DOMS.map((d) => ({ d, n: inDomain(d).filter((a) => a.mode === 'human-first').length })).filter(
    (x) => x.n < CONFIG.r1MinHumanFirst,
  );
  if (under.length) {
    under.sort((a, b) => a.n - b.n);
    const tied = under.filter((x) => x.n === under[0].n);
    const pick = tied[attempts.length % tied.length];
    return {
      decision: build({
        domain: pick.d,
        mode: 'human-first',
        errorRate: CONFIG.baseErrorRate,
        reasonCode: 'INSUFFICIENT_EVIDENCE',
        explanation: `Building your baseline: ${pick.n} of ${CONFIG.r1MinHumanFirst} human-first ${label(pick.d)} cases done.`,
      }),
    };
  }

  const metrics = Object.fromEntries(DOMS.map((d) => [d, computeMetrics(attempts, d)])) as Record<
    Domain,
    ReturnType<typeof computeMetrics>
  >;

  // R2: repeated switching to a wrong AI answer
  for (const d of DOMS) {
    const recent = inDomain(d).slice(-CONFIG.r2Window);
    const k = recent.filter((a) => a.outcome === 'automation-bias').length;
    if (k >= CONFIG.r2Events) {
      return {
        decision: build({
          domain: d,
          mode: 'human-first',
          errorRate: CONFIG.elevatedErrorRate,
          reasonCode: 'AUTOMATION_BIAS_PATTERN',
          explanation: `In your last ${recent.length} ${label(d)} cases you changed to an incorrect AI answer ${k} times. These cases test whether the AI's answer holds up against your own read.`,
          flags: { reflection: true },
        }),
      };
    }
  }

  // R3: low independent accuracy → guided case, practice case, then unaided check
  for (const d of DOMS) {
    const m = metrics[d].independentAccuracy;
    if (m.n >= CONFIG.minN.independent && m.value !== null && m.value < CONFIG.r3Threshold) {
      const da = inDomain(d);
      let lastGuided = -1;
      da.forEach((a, i) => {
        if (a.mode === 'guided') lastGuided = i;
      });
      const since = lastGuided === -1 ? Infinity : da.length - 1 - lastGuided;
      if (since === 0) {
        return {
          decision: build({
            domain: d,
            mode: 'human-first',
            errorRate: CONFIG.baseErrorRate,
            reasonCode: 'LOW_INDEPENDENT_ACCURACY',
            explanation: `Practice case after guided review. An unaided check comes next.`,
          }),
        };
      }
      if (since === 1) {
        return {
          decision: build({
            domain: d,
            mode: 'unaided',
            errorRate: 0,
            reasonCode: 'LOW_INDEPENDENT_ACCURACY',
            explanation: `Unaided check, two cases after guided practice.`,
          }),
        };
      }
      return {
        decision: build({
          domain: d,
          mode: 'guided',
          errorRate: 0,
          reasonCode: 'LOW_INDEPENDENT_ACCURACY',
          explanation: `Your independent ${label(d)} accuracy is ${pct(m.value)} over ${m.n} cases. This guided case shows what to look for first.`,
        }),
      };
    }
  }

  // R4: high-confidence answers are often wrong
  for (const d of DOMS) {
    const cal = metrics[d].calibration;
    if (cal.n >= CONFIG.minN.calibration && cal.highConfidenceCount >= 3 && cal.value !== null && cal.value >= CONFIG.r4Threshold) {
      return {
        decision: build({
          domain: d,
          mode: 'human-first',
          errorRate: CONFIG.baseErrorRate,
          reasonCode: 'OVERCONFIDENCE',
          explanation: `${pct(cal.value)} of your high-confidence ${label(d)} answers were wrong. Take a second look before you submit.`,
          flags: { calibrationPrompt: true },
        }),
      };
    }
  }

  // Target domain for R5/R6: the one with fewer attempts
  const totals = DOMS.map((d) => ({ d, n: inDomain(d).length }));
  totals.sort((a, b) => a.n - b.n);
  const tied = totals.filter((x) => x.n === totals[0].n);
  const target = tied[attempts.length % tied.length].d;
  const tm = metrics[target];
  const td = inDomain(target);

  // R5: verified independence → AI-first allowed, unaided check every Nth case
  if (
    tm.errorCatch.value !== null &&
    tm.errorCatch.n >= CONFIG.minN.errorCatch &&
    tm.errorCatch.value >= CONFIG.r5Catch &&
    tm.independentAccuracy.value !== null &&
    tm.independentAccuracy.n >= CONFIG.r5MinN &&
    tm.independentAccuracy.value >= CONFIG.r5Indep &&
    !(tm.underReliance.n >= 2 && (tm.underReliance.value ?? 0) >= CONFIG.r5MaxUnderReliance)
  ) {
    const k = td.filter((a) => a.reasonCode === 'VERIFIED_INDEPENDENCE').length;
    const unaided = (k + 1) % CONFIG.r5UnaidedEvery === 0;
    return {
      decision: build({
        domain: target,
        mode: unaided ? 'unaided' : 'ai-first',
        errorRate: CONFIG.baseErrorRate,
        reasonCode: 'VERIFIED_INDEPENDENCE',
        explanation: unaided
          ? `Routine unaided check (every ${CONFIG.r5UnaidedEvery}th case) to confirm your ${label(target)} reads hold up without the AI.`
          : `You catch most AI errors and read ${label(target)} well on your own, so AI-first cases are unlocked.`,
      }),
    };
  }

  // R6: default schedule. Every Nth default case is a matched-pair case.
  const k = td.filter((a) => a.reasonCode === 'DEFAULT_SCHEDULE').length;
  if (k % CONFIG.pairSlotEvery === CONFIG.pairSlotEvery - 1) {
    const slot = pairSlot(target, attempts, cases, pairs, rand);
    if (slot) {
      return {
        decision: build({
          domain: target,
          mode: slot.mode,
          errorRate: CONFIG.baseErrorRate,
          reasonCode: 'DEFAULT_SCHEDULE',
          explanation:
            slot.mode === 'ai-first'
              ? `Matched-pair case with the AI shown from the start. It measures assisted accuracy for the gap metric.`
              : `Matched-pair case without the AI. It measures unaided accuracy for the gap metric.`,
          caseId: slot.caseId,
          pairSlot: true,
        }),
        newPair: slot.newPair,
      };
    }
  }
  return {
    decision: build({
      domain: target,
      mode: 'human-first',
      errorRate: CONFIG.baseErrorRate,
      reasonCode: 'DEFAULT_SCHEDULE',
      explanation: `Regular practice: commit your read, then check it against the AI.`,
    }),
  };
}

function pairSlot(
  d: Domain,
  attempts: Attempt[],
  cases: CaseItem[],
  pairs: Record<string, PairAssignment>,
  rand: () => number,
): { mode: Mode; caseId: string; newPair?: PairAssignment } | null {
  // Only pairs whose two cases are both active can be used for the gap metric
  const inDom = cases.filter((c) => c.domain === d);
  const domainPairIds = [...new Set(inDom.map((c) => c.pairId))].filter((pid) => inDom.filter((c) => c.pairId === pid).length === 2);

  // Finish a half-done pair first
  for (const pid of domainPairIds) {
    const p = pairs[pid];
    if (!p || !cases.some((c) => c.id === p.aiFirstCaseId) || !cases.some((c) => c.id === p.unaidedCaseId)) continue;
    const done = attempts.filter((a) => a.pairSlot && a.pairId === pid);
    if (done.length === 1) {
      const mode: Mode = done[0].mode === 'ai-first' ? 'unaided' : 'ai-first';
      return { mode, caseId: mode === 'ai-first' ? p.aiFirstCaseId : p.unaidedCaseId };
    }
  }

  // Start a new pair, preferring the least-practised one
  const fresh = domainPairIds.filter((pid) => !pairs[pid]);
  if (!fresh.length) return null;
  const seenCount = (pid: string) => attempts.filter((a) => a.pairId === pid).length;
  const min = Math.min(...fresh.map(seenCount));
  const least = fresh.filter((pid) => seenCount(pid) === min);
  const pid = least[Math.floor(rand() * least.length)];
  const [c1, c2] = cases.filter((c) => c.pairId === pid);
  const swap = rand() < 0.5;
  const newPair: PairAssignment = {
    pairId: pid,
    aiFirstCaseId: swap ? c2.id : c1.id,
    unaidedCaseId: swap ? c1.id : c2.id,
    firstHalf: rand() < 0.5 ? 'ai-first' : 'unaided',
  };
  const mode: Mode = newPair.firstHalf;
  return { mode, caseId: mode === 'ai-first' ? newPair.aiFirstCaseId : newPair.unaidedCaseId, newPair };
}
