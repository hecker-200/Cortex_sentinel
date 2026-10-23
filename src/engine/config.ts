// Research parameters. These are starting values to set with a clinical
// collaborator, not validated cut-offs. Change POLICY_VERSION when you edit them.
export const POLICY_VERSION = 'policy-0.1';

export const CONFIG = {
  minN: {
    errorCatch: 4, // seeded-error cases
    automationBias: 4,
    independent: 6,
    gapPairs: 4,
    calibration: 8,
  },
  r1MinHumanFirst: 6,
  baseErrorRate: 0.25,
  elevatedErrorRate: 0.4,
  r2Window: 10,
  r2Events: 2,
  r3Threshold: 0.6,
  r4Threshold: 0.3,
  r5Catch: 0.8,
  r5Indep: 0.8,
  r5MinN: 10,
  /** R5 also requires that the trainee does not routinely reject a correct AI */
  r5MaxUnderReliance: 0.5,
  r5UnaidedEvery: 5,
  highConfidence: 4,
  /** In the default schedule, every Nth case is a matched-pair case */
  pairSlotEvery: 3,
} as const;

export const DOMAINS = ['lv', 'effusion'] as const;

export const DOMAIN_LABEL: Record<string, string> = {
  lv: 'LV function',
  effusion: 'Pericardial effusion',
};
