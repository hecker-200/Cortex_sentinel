import type { Attempt, CaseItem, PolicyDecision } from '../types';
import { classify } from './outcome';
import { uid } from './rng';

export function aiOutputFor(c: CaseItem, d: PolicyDecision) {
  return d.aiWrong ? c.ai.wrong : c.ai.correct;
}

export function aiVisible(d: PolicyDecision): boolean {
  return d.mode === 'human-first' || d.mode === 'ai-first';
}

/** Builds the stored record for one finished case. Outcome class is fixed at submit time. */
export function makeAttempt(args: {
  decision: PolicyDecision;
  c: CaseItem;
  initialAnswer: string;
  initialConfidence: number;
  finalAnswer: string;
  finalConfidence: number | null;
  durationMs: number;
  now?: number;
}): Attempt {
  const { decision: d, c } = args;
  const shown = aiVisible(d);
  const ai = shown ? aiOutputFor(c, d) : null;
  const aiCorrect = ai ? ai.answer === c.answer : null;
  const firstCorrect = args.initialAnswer === c.answer;
  const finalCorrect = args.finalAnswer === c.answer;
  return {
    id: uid('a_'),
    traineeId: d.traineeId,
    decisionId: d.id,
    caseId: c.id,
    pairId: c.pairId,
    domain: c.domain,
    mode: d.mode,
    pairSlot: d.pairSlot,
    aiShown: shown,
    aiCorrect,
    aiAnswer: ai ? ai.answer : null,
    aiErrorType: ai ? ai.errorType : null,
    initialAnswer: args.initialAnswer,
    initialConfidence: args.initialConfidence,
    finalAnswer: args.finalAnswer,
    finalConfidence: args.finalConfidence,
    switched: args.initialAnswer !== args.finalAnswer,
    firstCorrect,
    finalCorrect,
    outcome: classify(d.mode, aiCorrect, firstCorrect, finalCorrect),
    reasonCode: d.reasonCode,
    durationMs: args.durationMs,
    createdAt: args.now ?? Date.now(),
  };
}
