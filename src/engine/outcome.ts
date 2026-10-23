import type { Mode, OutcomeClass } from '../types';

/**
 * Classifies one attempt. For human-first cases this is the reliance matrix:
 * three facts (was the AI right, was the first read right, what did the trainee end with)
 * map to exactly one of six classes.
 */
export function classify(
  mode: Mode,
  aiCorrect: boolean | null,
  firstCorrect: boolean,
  finalCorrect: boolean,
): OutcomeClass {
  if (mode === 'human-first') {
    if (aiCorrect === false) {
      if (firstCorrect && finalCorrect) return 'caught-error';
      if (firstCorrect && !finalCorrect) return 'automation-bias';
      return 'missed-error';
    }
    if (firstCorrect) return 'aligned';
    if (finalCorrect) return 'appropriate-reliance';
    return 'under-reliance';
  }
  if (mode === 'ai-first') return finalCorrect ? 'assisted-correct' : 'assisted-incorrect';
  return finalCorrect ? 'unaided-correct' : 'unaided-incorrect';
}

export const RELIANCE_CLASSES: OutcomeClass[] = [
  'caught-error',
  'automation-bias',
  'missed-error',
  'aligned',
  'appropriate-reliance',
  'under-reliance',
];

export const OUTCOME_LABEL: Record<OutcomeClass, string> = {
  'caught-error': 'Caught error',
  'automation-bias': 'Automation bias',
  'missed-error': 'Missed error',
  aligned: 'Aligned',
  'appropriate-reliance': 'Appropriate reliance',
  'under-reliance': 'Under-reliance',
  'assisted-correct': 'Assisted, correct',
  'assisted-incorrect': 'Assisted, incorrect',
  'unaided-correct': 'Unaided, correct',
  'unaided-incorrect': 'Unaided, incorrect',
};

/** Neutral wording shown to the trainee. Never says "dependent" or "unsafe". */
export const OUTCOME_SENTENCE: Record<OutcomeClass, string> = {
  'caught-error': 'You kept your answer. The AI was wrong on this one, and your read was right.',
  'automation-bias': "You changed to the AI's answer. The AI was wrong here, and your first read was correct.",
  'missed-error': 'The AI was wrong here, and so was the first read. Compare the clip with the explanation below.',
  aligned: 'You and the AI agreed, and both were right.',
  'appropriate-reliance': "You changed to the AI's answer, and the AI was right.",
  'under-reliance': 'You kept your answer. The AI was right on this one.',
  'assisted-correct': 'Your answer with the AI visible was correct.',
  'assisted-incorrect': 'Your answer with the AI visible was not correct.',
  'unaided-correct': 'Your unaided read was correct.',
  'unaided-incorrect': 'Your unaided read was not correct.',
};

export type Tone = 'good' | 'warn' | 'crit' | 'neutral';

export const OUTCOME_TONE: Record<OutcomeClass, Tone> = {
  'caught-error': 'good',
  'automation-bias': 'crit',
  'missed-error': 'warn',
  aligned: 'good',
  'appropriate-reliance': 'good',
  'under-reliance': 'warn',
  'assisted-correct': 'good',
  'assisted-incorrect': 'warn',
  'unaided-correct': 'good',
  'unaided-incorrect': 'warn',
};
