import type { Attempt, Domain, OutcomeClass } from '../types';
import { CONFIG } from './config';

export interface Metric {
  value: number | null;
  n: number;
  provisional: boolean;
}

export interface DomainMetrics {
  errorCatch: Metric;
  automationBias: Metric;
  independentAccuracy: Metric;
  /** Assisted minus unaided accuracy on completed matched pairs (−1 to 1) */
  gap: Metric;
  /** Share of high-confidence first answers that were wrong */
  calibration: Metric & { highConfidenceCount: number };
  underReliance: Metric;
  counts: Record<OutcomeClass, number>;
  total: number;
}

const metric = (num: number, den: number, min: number): Metric => ({
  value: den > 0 ? num / den : null,
  n: den,
  provisional: den < min,
});

export function computeMetrics(all: Attempt[], domain: Domain): DomainMetrics {
  const a = all.filter((x) => x.domain === domain);
  const hf = a.filter((x) => x.mode === 'human-first');

  const aiWrong = hf.filter((x) => x.aiCorrect === false);
  const caught = aiWrong.filter((x) => x.outcome === 'caught-error').length;

  const aiWrongFirstRight = aiWrong.filter((x) => x.firstCorrect);
  const ab = aiWrongFirstRight.filter((x) => x.outcome === 'automation-bias').length;

  const indep = a.filter((x) => x.mode === 'human-first' || x.mode === 'unaided');
  const indepCorrect = indep.filter((x) => x.firstCorrect).length;

  // Matched pairs: both halves served as pair-slot cases
  const pairSlots = a.filter((x) => x.pairSlot);
  const byPair = new Map<string, { ai?: Attempt; un?: Attempt }>();
  for (const x of pairSlots) {
    const e = byPair.get(x.pairId) ?? {};
    if (x.mode === 'ai-first') e.ai = x;
    if (x.mode === 'unaided') e.un = x;
    byPair.set(x.pairId, e);
  }
  const complete = [...byPair.values()].filter((e) => e.ai && e.un);
  let gapValue: number | null = null;
  if (complete.length > 0) {
    const aiAcc = complete.filter((e) => e.ai!.finalCorrect).length / complete.length;
    const unAcc = complete.filter((e) => e.un!.finalCorrect).length / complete.length;
    gapValue = aiAcc - unAcc;
  }

  const rated = a.filter((x) => x.mode !== 'ai-first');
  const high = rated.filter((x) => x.initialConfidence >= CONFIG.highConfidence);
  const highWrong = high.filter((x) => !x.firstCorrect).length;

  const disagreeAiRight = hf.filter((x) => x.aiCorrect === true && x.initialAnswer !== x.aiAnswer);
  const under = disagreeAiRight.filter((x) => x.outcome === 'under-reliance').length;

  const counts = {} as Record<OutcomeClass, number>;
  for (const x of a) counts[x.outcome] = (counts[x.outcome] ?? 0) + 1;

  return {
    errorCatch: metric(caught, aiWrong.length, CONFIG.minN.errorCatch),
    automationBias: metric(ab, aiWrongFirstRight.length, CONFIG.minN.automationBias),
    independentAccuracy: metric(indepCorrect, indep.length, CONFIG.minN.independent),
    gap: { value: gapValue, n: complete.length, provisional: complete.length < CONFIG.minN.gapPairs },
    calibration: {
      value: high.length > 0 ? highWrong / high.length : null,
      n: rated.length,
      provisional: rated.length < CONFIG.minN.calibration,
      highConfidenceCount: high.length,
    },
    underReliance: metric(under, disagreeAiRight.length, CONFIG.minN.automationBias),
    counts,
    total: a.length,
  };
}

export function pct(v: number | null, digits = 0): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function signedPts(v: number | null): string {
  if (v === null) return '—';
  const p = Math.round(v * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)} pts`;
}
