export function checkGuardrails(formData: unknown, pathwayMode: string): any;
export const AUA_PSA_THRESHOLDS: Record<string, { threshold: number; [key: string]: unknown }>;

// Output-statement tier keys (product spec) for Part 1 / Part 2 / Part 3.
export type Part1TierKey =
  | 'screening_not_indicated'
  | 'discussion_optional'
  | 'discussion_advised_extended_risk'
  | 'screening_recommended';

export type Part2TierKey =
  | 'normal_routine_interval'
  | 'unconfirmed_repeat_advised'
  | 'borderline_repeat_advised'
  | 'urology_red_flag_referral'
  | 'gray_zone_confounder_reassess'
  | 'elevated_imaging_advised'
  | 'markedly_elevated_prompt_referral';

export type Part3TierKey =
  | 'biopsy_not_indicated'
  | 'monitoring_advised'
  | 'biopsy_discussion_advised'
  | 'biopsy_recommended';

export interface Part1Tier {
  key: Part1TierKey;
  label: string;
  description: string;
  guidelineCriteriaMet: boolean;
  extendedRiskScore: number;
  extendedRiskStrength: 'none' | 'limited' | 'strong';
  priorBiopsyHistory: boolean;
}

export interface Part2Tier {
  key: Part2TierKey;
  label: string;
  description: string;
  ageAdjustedThreshold: number;
  grayZoneUpper: number;
  confounders: {
    // Informational-only per AUA/SUO 2026's own text ("neither DRE nor bicycle
    // riding appreciably alters the PSA") — surfaced for clinician visibility,
    // not counted in `any`/tier selection. See epsaEngine.js AUDIT CORRECTION
    // comment above the Part 2 confounder block.
    recentVigorousCycling: boolean;
    drePerformedBeforeDraw: boolean;
    // Tier-changing: urinary/infective symptoms (confirmed), ejaculation
    // (modest ~10% effect), and recent instrumentation (catheterization,
    // prostate biopsy, or cystoscopy) per the same guideline text.
    recentEjaculation: boolean;
    urinarySymptomsInfection: boolean;
    recentInstrumentation: boolean;
    any: boolean;
    informationalOnly: boolean;
  };
  strongRiskFactor: {
    guideline: boolean;
    extended: boolean;
    any: boolean;
  };
  // Whether the input PSA was confirmed on a repeat test (AUA/SUO 2026 EDPC,
  // Expert Opinion under Statement 3). Defaults to true when the caller omits
  // `psaConfirmed` on postData, so existing callers see no behavior change.
  psaConfirmed: boolean;
  // Exam/symptom findings that bypass PSA-based tiering entirely — see
  // 'urology_red_flag_referral' in Part2TierKey.
  urologyRedFlag: {
    hematuria: boolean;
    retention: boolean;
    abnormalDre: boolean;
    any: boolean;
  };
}

// New optional Part 2 confounder input fields (postData) — see calculateDynamicEPsaPost.
// Nullable (not just optional): backend/src/psaEngine.ts's zod schema accepts
// `null` for these (the Firebase callable-function wire serializes an
// `undefined` client field as `null`, so every optional field in that schema
// is `.nullable().optional()` — see that file's own comment on this).
export interface Part2ConfounderInput {
  recentVigorousCycling?: boolean | null;
  drePerformedBeforeDraw?: boolean | null;
  recentEjaculation?: boolean | null;
  urinarySymptomsInfection?: boolean | null;
  recentInstrumentation?: boolean | null;
  psaConfirmed?: boolean | null;
  urologyRedFlagHematuria?: boolean | null;
  urologyRedFlagRetention?: boolean | null;
  urologyRedFlagAbnormalDre?: boolean | null;
}

// New optional Part 1 input field (formData) — see calculateDynamicEPsa. Same
// nullable rationale as Part2ConfounderInput above.
export interface Part1ExtendedRiskInput {
  priorBiopsyHistory?: boolean | 'yes' | 'no' | null;
}

// calculateDynamicEPsa/calculateDynamicEPsaPost return large, long-established
// result objects (dozens of pre-existing fields — score, risk, tierRisk,
// guardrailAlerts, itemImpacts, guidelineTrack, epsaExtendedProfile, etc.) that
// predate this change and aren't exhaustively typed here — doing so risked
// asserting a shape that silently drifts from the real implementation. Rather
// than leave the whole return value untyped as `any` (which erased type
// checking for the new part1Tier/part2Tier fields too), these interfaces type
// ONLY the fields this change added or directly touches, with an index
// signature covering everything else untyped-but-present, same as before.
export interface EPsaPart1Result {
  part1Tier: Part1Tier;
  score: number;
  recommendPSA: boolean | null;
  psaRecommendReason: string | null;
  [key: string]: unknown;
}

export interface EPsaPart2Result {
  part2Tier: Part2Tier | null;
  psaAdjusted: number | null;
  psaAdjustedFlag: boolean;
  [key: string]: unknown;
}

export function calculateDynamicEPsa(
  formData: Part1ExtendedRiskInput & Record<string, unknown>,
  customConfig?: unknown
): EPsaPart1Result;

export function calculateDynamicEPsaPost(
  preResult: EPsaPart1Result | Record<string, unknown>,
  postData: Part2ConfounderInput & Record<string, unknown>,
  customConfig?: unknown
): EPsaPart2Result;

export interface BiopsyRiskResult {
  prob: number;
  percent: number;
  interpretation: string;
  tier: { key: Part3TierKey; label: string };
  guidelineRate: string;
  reliable: boolean;
  psad: number | null;
  psadTier: string | null;
  modelVersion: string;
}
export function predictBiopsyRisk(
  pirads: number,
  psa: number,
  prostateVolumeCc?: number | null,
  psad?: number | null
): BiopsyRiskResult | null;
export const BIOPSY_GUIDELINE_RATES: Record<number, string>;
export const BIOPSY_RELIABLE_PIRADS: Set<number>;
export const BIOPSY_MODEL_VERSION: string;
export const BIOPSY_THRESHOLD: number;

export const ENGINE_VERSION: string;
export const GUIDELINE_VERSION: string;
