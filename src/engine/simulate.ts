import type { Attempt, CaseItem, PairAssignment, PolicyDecision, ReasonCode, Trainee } from '../types';
import { aiOutputFor, makeAttempt } from './attempt';
import { decideNext } from './policy';
import { rngFor } from './rng';

export interface Persona {
  key: string;
  name: string;
  description: string;
  accuracy: number;
  /** Accuracy lost per difficulty step above 1 */
  difficultyPenalty: number;
  switchWhenAIWrong: number;
  switchWhenAIRight: number;
  confidence: (correct: boolean, r: () => number) => number;
  /** The rule this persona should trigger at some point */
  expected?: ReasonCode;
}

const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

export const PERSONAS: Persona[] = [
  {
    key: 'automation-biased',
    name: 'Sim · Automation-biased',
    description: 'Reads well alone but usually switches to the AI when it disagrees.',
    accuracy: 0.82,
    difficultyPenalty: 0.05,
    switchWhenAIWrong: 0.8,
    switchWhenAIRight: 0.85,
    confidence: (_c, r) => between(r, 2, 4),
    expected: 'AUTOMATION_BIAS_PATTERN',
  },
  {
    key: 'overconfident',
    name: 'Sim · Overconfident',
    description: 'Always rates 5/5 confidence, but about a third of first reads are wrong.',
    accuracy: 0.78,
    difficultyPenalty: 0.1,
    switchWhenAIWrong: 0.05,
    switchWhenAIRight: 0.15,
    confidence: () => 5,
    expected: 'OVERCONFIDENCE',
  },
  {
    key: 'weak',
    name: 'Sim · Struggling reader',
    description: 'Independent reads are wrong more often than right.',
    accuracy: 0.42,
    difficultyPenalty: 0.05,
    switchWhenAIWrong: 0.5,
    switchWhenAIRight: 0.6,
    confidence: (_c, r) => between(r, 1, 3),
    expected: 'LOW_INDEPENDENT_ACCURACY',
  },
  {
    key: 'strong',
    name: 'Sim · Strong verifier',
    description: 'Accurate, well calibrated, and rarely follows a wrong AI answer.',
    accuracy: 0.97,
    difficultyPenalty: 0.02,
    switchWhenAIWrong: 0.02,
    switchWhenAIRight: 0.7,
    confidence: (c, r) => (c ? between(r, 4, 5) : between(r, 2, 3)),
    expected: 'VERIFIED_INDEPENDENCE',
  },
  {
    key: 'under-relier',
    name: 'Sim · Under-relier',
    description: 'Never changes a read, even when the AI is right.',
    accuracy: 0.72,
    difficultyPenalty: 0.06,
    switchWhenAIWrong: 0,
    switchWhenAIRight: 0.03,
    confidence: () => 3,
  },
];

export interface SimResult {
  trainee: Trainee;
  attempts: Attempt[];
  decisions: PolicyDecision[];
  pairs: Record<string, PairAssignment>;
}

export function simulateTrainee(persona: Persona, cases: CaseItem[], n = 40, seed = 'sim', t0 = Date.now()): SimResult {
  const trainee: Trainee = { id: `sim-${persona.key}-${seed}`, name: persona.name, createdAt: t0, persona: persona.key };
  const attempts: Attempt[] = [];
  const decisions: PolicyDecision[] = [];
  const pairs: Record<string, PairAssignment> = {};

  for (let i = 0; i < n; i++) {
    const now = t0 + i * 90_000;
    const { decision, newPair } = decideNext({ traineeId: trainee.id, attempts, cases, pairs, now });
    if (newPair) pairs[newPair.pairId] = newPair;
    decisions.push(decision);

    const c = cases.find((x) => x.id === decision.caseId)!;
    const r = rngFor(seed, persona.key, i, 'answer');
    const guidedBonus = decision.mode === 'guided' ? 0.1 : 0;
    const p = Math.max(0.05, Math.min(0.99, persona.accuracy - (c.difficulty - 1) * persona.difficultyPenalty + guidedBonus));
    const wrongOptions = c.options.filter((o) => o.value !== c.answer);
    const first = r() < p ? c.answer : wrongOptions[Math.floor(r() * wrongOptions.length)].value;
    const conf = persona.confidence(first === c.answer, r);

    let final = first;
    if (decision.mode === 'human-first' || decision.mode === 'ai-first') {
      const ai = aiOutputFor(c, decision);
      if (ai.answer !== first) {
        const aiRight = ai.answer === c.answer;
        if (r() < (aiRight ? persona.switchWhenAIRight : persona.switchWhenAIWrong)) final = ai.answer;
      }
    }
    const initial = decision.mode === 'ai-first' ? final : first;
    attempts.push(
      makeAttempt({
        decision,
        c,
        initialAnswer: initial,
        initialConfidence: conf,
        finalAnswer: final,
        finalConfidence: decision.mode === 'human-first' ? conf : null,
        durationMs: 20_000 + Math.floor(r() * 40_000),
        now: now + 45_000,
      }),
    );
  }
  return { trainee, attempts, decisions, pairs };
}

export interface PersonaCheck {
  persona: Persona;
  passed: boolean | null;
  firstFiredAt: number | null;
  rulesFired: ReasonCode[];
}

export function runPersonaChecks(cases: CaseItem[], n = 40): PersonaCheck[] {
  return PERSONAS.map((persona) => {
    const sim = simulateTrainee(persona, cases, n, 'check', 0);
    const codes = sim.decisions.map((d) => d.reasonCode);
    const idx = persona.expected ? codes.indexOf(persona.expected) : -1;
    return {
      persona,
      passed: persona.expected ? idx >= 0 : null,
      firstFiredAt: idx >= 0 ? idx + 1 : null,
      rulesFired: [...new Set(codes)],
    };
  });
}
