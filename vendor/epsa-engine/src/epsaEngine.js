import { DEFAULT_CALCULATOR_CONFIG } from './calculatorConfig.js';
import { ENGINE_VERSION } from './version.js';

// =============================================================================
// ePSA CALCULATOR ENGINE v4
// =============================================================================
//
// Four clinical models:
//
//   Model 1 — calculateDynamicEPsa()
//     Pathway: pre_psa — "Should I get a PSA test?"
//     Input:   27-question questionnaire
//     Output:  rawScore 0-80, 3-tier (Low/Intermediate/Elevated),
//              PSA recommendation + reason, empirical csPCa probability
//     AUC: 0.579 [0.442-0.712]  Sens: 91.3%  NPV: 89.5%  N=94
//
//   Model 2 — calculateDynamicEPsaPost() with pathwayMode='post_psa'
//     Pathway: post_psa — "I have a PSA result"
//     Input:   Part 1 result + PSA value (+ optional prostate volume for PSAD)
//     Output:  combined tier, discordance flag, low-PSA warning, PSAD,
//              empirical csPCa probability by combined tier
//     AUC: 0.600 [0.463-0.735]  vs PSA alone 0.579  N=94
//
//   Model 3 — calculateDynamicEPsaPost() with pathwayMode='post_mri'
//     Pathway: post_mri — "I had a PSA and an MRI"
//     Input:   Part 1 result + PSA + PI-RADS + optional prostate volume
//     Output:  combined tier, biopsy recommendation banner
//     Note:    high-grade risk sub-calculation is calcHighGradeRisk() below —
//              N=96 logistic regression, AUC 0.591 OOF (see its docstring
//              and MODEL_ACCURACY.model3 below, which reflect the same model).
//
//   Model 4 — calculateActiveSurveillance() — MOVED to standalone AS Tool repo
//     See: as.millionstrongmen.com
//
// Empirical csPCa rates (N=94, 23 csPCa GG≥3):
//   ePSA Low (0-10):            7%  [95%CI 1%-31%]   N=14
//   ePSA Intermediate (11-17): 20%  [95%CI 4%-62%]   N=5
//   ePSA Elevated (≥18):       28%  [95%CI 19%-39%]  N=75
//   Combined Int-High (28-55): 21%  N=58
//   Combined High (≥56):       31%  N=32
//
// =============================================================================

// ---------------------------------------------------------------------------
// EMPIRICAL CALIBRATION DATA — from N=94 validation cohort
// Used to display "X in Y patients like you had csPCa" messaging
// ---------------------------------------------------------------------------
const EPSA_TIER_CALIBRATION = {
  low:          { rate: 0.07,  ci_lo: 0.01, ci_hi: 0.31, n: 14,  events: 1  },
  intermediate: { rate: 0.20,  ci_lo: 0.04, ci_hi: 0.62, n: 5,   events: 1  },
  elevated:     { rate: 0.28,  ci_lo: 0.19, ci_hi: 0.39, n: 75,  events: 21 }
};

const COMBINED_TIER_CALIBRATION = {
  'low':              { rate: null, n: 0,  events: 0,  note: 'No data in referral cohort' },
  'intermediate-low': { rate: 0.25, n: 4,  events: 1,  note: 'Small N — interpret with caution' },
  'intermediate-high':{ rate: 0.21, n: 58, events: 12, note: 'N=94 biopsied referral cohort' },
  'high':             { rate: 0.31, n: 32, events: 10, note: 'N=94 biopsied referral cohort' }
};

// ---------------------------------------------------------------------------
// AUA_PSA_THRESHOLDS — canonical PSA thresholds from AUA/SUO 2026
// Source: AUA/SUO Early Detection of Prostate Cancer Guideline 2023, amended 2026
// These are the authoritative values used by AUAFlowchart.jsx and the engine.
// Do NOT change without updating both this block and the flowchart component.
// ---------------------------------------------------------------------------
// CORRECTION (2026-06-02): age50_69 split into age50_59 (3.5) and age60_69 (4.5).
// AUA 2026 EDPC p.11: "3.5 ng/mL for people in their 50s, 4.5 ng/mL for people in their 60s"
// Prior single 3.5 threshold for ages 50–69 under-thresholded men aged 60–69.
// ---------------------------------------------------------------------------
export const AUA_PSA_THRESHOLDS = {
  age45_49: {
    threshold:     2.5,
    action_below:  'resume_at_50',         // PSA < 2.5 → no immediate follow-up, re-enter at 50
    action_above:  'biannual',             // PSA ≥ 2.5 → every 2 years
    grade:         'Conditional — Grade B',
    source:        'AUA/SUO 2026 Statement 4',
  },
  age50_59: {
    threshold:     3.5,
    action_below:  'biannual_sdm',         // PSA < 3.5 → every 2–4 years (SDM may extend)
    action_above:  'urology_referral',     // PSA ≥ 3.5 → confirmatory PSA, then urology
    grade:         'Strong — Grade A',
    source:        'AUA/SUO 2026 Statement 6',
  },
  age60_69: {
    threshold:     4.5,                    // CORRECTED from 3.5 — AUA 2026 EDPC p.11 (verified)
    action_below:  'biannual_sdm',         // PSA < 4.5 → every 2–4 years (SDM may extend)
    action_above:  'urology_referral',     // PSA ≥ 4.5 → confirmatory PSA, then urology
    grade:         'Strong — Grade A',
    source:        'AUA/SUO 2026 Statement 6 — age-varying threshold: 4.5 ng/mL for ages 60–69',
  },
  age70plus: {
    threshold:           6.5,
    lifeExpectancyYears: 10,               // LE < 10y → discontinue regardless of PSA
    action_below:        'discontinue_or_lengthen', // PSA < 6.5 + LE ≥ 10y → SDM
    action_above:        'urology_referral',        // PSA ≥ 6.5 + LE ≥ 10y → urology
    grade:               'SDM — individualized',
    // Statement 7: personalize re-screening interval — Conditional, Grade B (AUA 2026 p.2).
    // NOTE: Statement 8 in AUA 2026 = DRE alongside PSA (Conditional, Grade C).
    // Prior versions incorrectly cited "Statement 8" for the older-patient SDM recommendation.
    source:              'AUA/SUO 2026 Statement 7 (SDM); age-varying threshold per EDPC p.11',
  },
};

// ---------------------------------------------------------------------------
// VALIDATION ACCURACY SUMMARY — for display in UI if needed
// ---------------------------------------------------------------------------
export const MODEL_ACCURACY = {
  model1: {
    auc: 0.579, auc_ci_lo: 0.442, auc_ci_hi: 0.712,
    sensitivity: 0.913, specificity: 0.239, npv: 0.895, ppv: 0.280,
    n: 94, events: 23, threshold: 'rawScore >= 18',
    note: 'Equivalent to PSA ≥4.0 at same sensitivity with 3 fewer false positives'
  },
  model2: {
    auc: 0.600, auc_ci_lo: 0.463, auc_ci_hi: 0.735,
    n: 94, events: 23,
    note: 'AUC gain over PSA alone (+0.021) not yet significant at N=94 (p=0.725)'
  },
  // Legacy N=83 GG3+ model — superseded by calcHighGradeRisk() (N=96, GG≥2, AUC 0.591 OOF).
  // Kept for historical reference in ModelDocumentation.jsx; not used in any live calculation.
  model3: {
    auc: 0.591,
    auc_cv: 0.591,
    auc_cv_sd: null,
    n: 96,
    events: 71,
    outcome: 'GG≥2 (clinically significant PCa)',
    note: 'Dummy-variable logistic regression trained on N=96 Mount Sinai biopsy registry patients ' +
          '(prevalence 74% GG≥2, run 2026-06-02). PIRADS 4 and 5 properly separated as dummy variables. ' +
          'GG≥2 AUC 0.591 (5-fold CV × 100 repeats). ' +
          'No prostate volume in dataset; PSAD pending data collection. ' +
          'Replaces prior GG3+ linear-PIRADS model from PR #60 (N=83, AUC 0.694).'
  },
  model4: {
    auc_gg1: 0.624, auc_psa_gg1: 0.513,
    low_int_as_rate: 0.89,
    note: 'ePSA predicts GG1 AS-eligibility better than PSA alone (AUC 0.624 vs 0.513)'
  }
};

/**
 * @deprecated Superseded by `predictBiopsyRisk` (biopsyRisk.js), which tracks
 * the actively-retrained model from Urology-AI/biopsy-prediction (currently
 * v4, N=126, AUC 0.7389 — vs. this function's frozen N=96/AUC 0.591 snapshot
 * from 2026-06-02). Kept only because epsaEngine.test.js asserts against it
 * for historical regression coverage; do not wire this into any new caller —
 * use `predictBiopsyRisk` instead.
 *
 * Calculates predicted probability of GG≥2 (clinically significant) prostate cancer
 * from PI-RADS score and PSA using logistic regression trained on N=96 patients.
 *
 * Model (dummy-variable logistic regression):
 *   logit(GG≥2) = 0.356742
 *               + (−0.017489) × ln(PSA)     [near-zero: PSA adds little once PIRADS known]
 *               + (−0.061356) × [PIRADS=3]  [ref: PIRADS ≤2]
 *               + 0.967766    × [PIRADS=4]
 *               + 1.255289    × [PIRADS=5]
 *
 * Outcome:   GG≥2 — AUA/SUO 2026 definition of clinically significant PCa (p.4)
 * Cohort:    N=96, Mount Sinai biopsy registry, prevalence 74% GG≥2, run 2026-06-02
 * AUC OOF:  0.591 (5-fold CV × 100 repeats)
 * Weights:   calculatorConfig.js → part2.models.mri
 *
 * AUA 2026 GUIDELINE TABLE 5 — Population-level GG≥2 detection rates by PI-RADS
 * (pooled 23 studies; AUA/SUO EDPC 2026 p.21):
 *   PI-RADS 1–2:  7% (95%CI 4–11%)
 *   PI-RADS 3:   11% (95%CI 8–14%)
 *   PI-RADS 4:   37% (95%CI 33–40%)
 *   PI-RADS 5:   70% (95%CI 62–79%)
 *
 * @param {number} pirads  - PI-RADS score (1–5)
 * @param {number} psa     - PSA in ng/mL (raw, before any 5-ARI correction)
 * @returns {{ prob: number, percent: number, interpretation: string, guidelineRate: string } | null}
 */
export function calcHighGradeRisk(pirads, psa) {
  if (pirads == null || psa == null) return null;
  const p = Number(pirads);
  const s = Number(psa);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s < 0) return null;
  if (![1, 2, 3, 4, 5].includes(p)) return null;

  // Dummy variables — reference category is PIRADS ≤2 (includes 1 and 2)
  const pirads3 = p === 3 ? 1 : 0;
  const pirads4 = p === 4 ? 1 : 0;
  const pirads5 = p === 5 ? 1 : 0;
  const logPSA  = Math.log(Math.max(s, 0.01));

  const logit = 0.356742
    + (-0.017489) * logPSA
    + (-0.061356) * pirads3
    +   0.967766  * pirads4
    +   1.255289  * pirads5;

  const prob = 1 / (1 + Math.exp(-logit));
  const percent = Math.round(prob * 1000) / 10;

  // Guideline Table 5 detection rates (AUA 2026 p.21)
  const GUIDELINE_RATES = {
    1: '7% (95%CI 4–11%) — AUA 2026 Table 5 (PI-RADS 1–2)',
    2: '7% (95%CI 4–11%) — AUA 2026 Table 5 (PI-RADS 1–2)',
    3: '11% (95%CI 8–14%) — AUA 2026 Table 5',
    4: '37% (95%CI 33–40%) — AUA 2026 Table 5',
    5: '70% (95%CI 62–79%) — AUA 2026 Table 5',
  };
  const guidelineRate = GUIDELINE_RATES[p] || null;

  // Thresholds calibrated to 74% GG≥2 baseline (biopsied cohort)
  let interpretation;
  if (prob < 0.60)      interpretation = 'Below-average GG≥2 risk (for a biopsied cohort)';
  else if (prob < 0.74) interpretation = 'Near-average GG≥2 risk';
  else if (prob < 0.82) interpretation = 'Elevated GG≥2 risk';
  else                  interpretation = 'High GG≥2 risk';

  return { prob, percent, interpretation, guidelineRate };
}

// GUARDRAILS — fires when ePSA input exceeds validated model range or
// clinical guidelines require immediate action rather than a score.
// Based on: AUA/SUO 2026, NCCN 2024, EAU 2024.
export function checkGuardrails(formData, pathwayMode) {
  const alerts = [];
  const psaNum    = Number(formData?.psa);
  const piradsNum = Number(formData?.pirads);
  const psadNum   = (formData?.psad != null && formData.psad !== '')
    ? Number(formData.psad)
    : (formData?.psa && formData?.prostateVolume
        ? Number(formData.psa) / Number(formData.prostateVolume)
        : null);
  const ggg = Number(formData?.ggg);
  const age = Number(formData?.age);

  // 1. PSA > 100: outside model range, refer immediately.
  // Rationale: PSMA PET staging data show 87.5% probability of any metastatic disease at
  // PSA > 100 ng/mL (Luining et al. Eur Urol Open Sci. 2024;59:1-8, epub 2023). EAU 2024 and NCCN guidelines
  // both recommend staging imaging (bone scan or PSMA-PET) for high- and very-high-risk PCa
  // regardless of PSA level; PSA > 100 virtually always meets that threshold. The ePSA model
  // was derived on PSA ≤ ~40 ng/mL — extrapolating beyond that range produces unreliable scores.
  if (Number.isFinite(psaNum) && psaNum > 100) {
    alerts.push({
      level: 'critical',
      code: 'PSA_VERY_HIGH',
      title: 'PSA > 100 ng/mL — Immediate Urology Referral Required',
      message:
        `A PSA of ${psaNum} ng/mL is far outside the validated range of this tool (derived on ` +
        'PSA ≤ ~40 ng/mL). PSMA PET staging data show an 87.5% probability of any metastatic ' +
        'disease at PSA > 100 ng/mL. ePSA risk scores are not interpretable at this level. ' +
        'Staging imaging (bone scan or PSMA-PET) and prompt urology referral are required ' +
        'before any treatment planning. Do not rely on this tool\'s output at this PSA value.',
      guideline:
        'Luining WI et al. Eur Urol Open Sci. 2024;59:1–8. doi:10.1016/j.euros.2023.12.001 ' +
        '(87.5% any metastatic disease at PSA > 100 ng/mL on PSMA PET, N=2,193); ' +
        'EAU 2024 Prostate Cancer Guidelines — staging imaging (bone scan or PSMA-PET) ' +
        'recommended for high- and very-high-risk disease (Cornford P et al. Eur Urol. 2021;79(2):263–282, updated 2024); ' +
        'NCCN Prostate Cancer v1.2025 — bone scan recommended for high/very-high-risk patients.',
    });
  }

  // 2. GG4 or GG5 entered in AS Tool: not eligible for AS per guidelines
  if (pathwayMode === 'active_surveillance' && (ggg === 4 || ggg === 5)) {
    alerts.push({
      level: 'critical',
      code: 'GG_NOT_AS_ELIGIBLE',
      title: 'GG4/5 — Not Eligible for Active Surveillance',
      message:
        'Grade Group 4 or 5 disease is a contraindication to active surveillance per all major ' +
        'guidelines. This tool is validated for GG1–3 only. Treatment discussion is recommended.',
      guideline: 'AUA/SUO 2022 AS Guidelines; EAU 2024 §6.2; NCCN 2024 PROST-2',
    });
  }

  // 3. PSAD > 0.5 with PI-RADS 4 or 5: immediate biopsy threshold
  if (Number.isFinite(psadNum) && psadNum > 0.5 && piradsNum >= 4) {
    alerts.push({
      level: 'warning',
      code: 'PSAD_PIRADS_BIOPSY_THRESHOLD',
      title: 'PSAD > 0.5 + PI-RADS ≥4 — Biopsy Threshold Exceeded',
      message:
        `PSAD of ${psadNum.toFixed(2)} ng/mL/cm³ combined with PI-RADS ${piradsNum} meets ` +
        'criteria for biopsy recommendation per EAU 2024 and NCCN 2024 guidelines, independent ' +
        'of ePSA score. ePSA results are provided for context only.',
      guideline:
        'EAU 2024 Prostate Cancer §5.1.3; NCCN 2024 PROST-3; Kadeer et al. 2025 PSAD cutoff 0.177',
    });
  }

  // 4. Life expectancy gate: age >=75 or 2+ comorbidities — screening benefit
  // uncertain regardless of risk score. Purely additive; does not alter rawScore.
  // Rationale: EDPC 2026 p.15 — "for patients with less than a ten-year estimated
  // life expectancy, screening is not likely to provide a benefit... American patients
  // older than 77 years of age have less than a 10-year life expectancy." Comorbidity
  // burden is a recognized life-expectancy modifier (competing-mortality risk), distinct
  // from its separate role as a cancer-risk score contributor above.
  const hasTwoComorbidities = Boolean(formData?.hasTwoComorbidities);
  if ((Number.isFinite(age) && age >= 75) || hasTwoComorbidities) {
    alerts.push({
      level: 'info',
      code: 'LIFE_EXPECTANCY_GATE',
      title: 'Screening Benefit May Be Limited — Discuss Life Expectancy',
      message:
        (Number.isFinite(age) && age >= 75
          ? `At age ${age}, median life expectancy is commonly under 10 years. `
          : 'A significant comorbidity burden can shorten life expectancy below 10 years. ') +
        'Guidelines indicate that when life expectancy is under 10 years, PSA screening is ' +
        'unlikely to provide a mortality benefit, regardless of risk score. This is a starting ' +
        'point for a conversation with your physician about your individual life expectancy and ' +
        'whether continued screening is likely to help — not a standalone decision.',
      guideline: 'AUA/SUO 2026 EDPC p.15 (life expectancy <10y screening threshold); AUA/SUO 2026 Statement 1 (shared decision-making)',
    });
  }

  return alerts;
}

export const validateInputs = (formData, config = DEFAULT_CALCULATOR_CONFIG) => {
  const errors = [];
  const warnings = [];

  const { validation } = config || {};

  const requireNumber = (value, field) => {
    if (value === undefined || value === null || value === '') {
      errors.push(`${field} is required`);
      return null;
    }
    const num = Number(value);
    if (Number.isNaN(num)) {
      errors.push(`${field} must be a number`);
      return null;
    }
    return num;
  };

  const ageNum = requireNumber(formData?.age, 'Age');
  const bmiNum = requireNumber(formData?.bmi, 'BMI');

  const validateOrdinalArray = (fieldLabel, values, expectedLength, minValue, maxValue) => {
    if (!Array.isArray(values)) {
      errors.push(`${fieldLabel} responses are required`);
      return null;
    }
    if (values.length !== expectedLength) {
      errors.push(`${fieldLabel} must contain ${expectedLength} responses`);
      return null;
    }
    let total = 0;
    for (let i = 0; i < values.length; i += 1) {
      const raw = values[i];
      if (raw === null || raw === undefined || raw === '') {
        errors.push(`${fieldLabel} response ${i + 1} is required`);
        return null;
      }
      const score = Number(raw);
      if (!Number.isFinite(score) || !Number.isInteger(score)) {
        errors.push(`${fieldLabel} response ${i + 1} must be an integer`);
        return null;
      }
      if (score < minValue || score > maxValue) {
        errors.push(`${fieldLabel} response ${i + 1} must be between ${minValue} and ${maxValue}`);
        return null;
      }
      total += score;
    }
    return total;
  };

  if (!formData?.race) errors.push('Race is required');

  if (formData?.exercise === undefined || formData?.exercise === null || formData?.exercise === '') {
    errors.push('Exercise level is required');
  } else {
    const ex = Number(formData.exercise);
    if (![0, 1, 2].includes(ex)) {
      errors.push('Exercise level must be one of: 0 (regular), 1 (some), 2 (none)');
    }
  }

  if (formData?.familyHistory === undefined || formData?.familyHistory === null) {
    errors.push('Family history is required');
  }

  const comorbidityLabels = {
    hypertension: 'Hypertension (HTN)',
    hyperlipidemia: 'Hyperlipidemia (HLD)',
    coronaryArteryDisease: 'Coronary Artery Disease (CAD)',
    diabetes: 'Diabetes'
  };

  const hasComorbidityScore =
    formData?.comorbidityScore !== undefined && formData?.comorbidityScore !== null;
  if (hasComorbidityScore) {
    const s = Number(formData.comorbidityScore);
    if (s !== 0 && s !== 1 && s !== 2) errors.push('Comorbidities must be 0, 1, or 2');
  } else {
    for (const key of Object.keys(comorbidityLabels)) {
      if (formData?.[key] === undefined || formData?.[key] === null || formData?.[key] === '') {
        errors.push(`${comorbidityLabels[key]} is required`);
        break;
      }
    }
  }

  const ipssTotal = validateOrdinalArray('IPSS', formData?.ipss, 7, 0, 5);
  const shimTotal = validateOrdinalArray('SHIM', formData?.shim, 5, 0, 5);

  if (validation) {
    if (ageNum != null && (ageNum < validation.minAge || ageNum > validation.maxAge)) {
      errors.push(`Age must be between ${validation.minAge} and ${validation.maxAge}`);
    }
    if (bmiNum != null) {
      if (bmiNum < validation.minBMI) errors.push(`BMI must be at least ${validation.minBMI}`);
      if (bmiNum > validation.maxBMI) {
        warnings.push(`BMI is above the validated range (>${validation.maxBMI}); results may be less accurate.`);
      }
    }
  }

  if (ipssTotal != null && (ipssTotal < 0 || ipssTotal > 35)) {
    errors.push('IPSS total must be between 0 and 35');
  }
  if (shimTotal != null && (shimTotal < 0 || shimTotal > 25)) {
    errors.push('SHIM total must be between 0 and 25');
  }
  if (ageNum != null && ageNum < 40) {
    warnings.push('Age under 40: model may be less validated in very young patients');
  }

  return { errors, warnings };
};

// =============================================================================
// MODEL 1 — pre_psa: "Should I get a PSA test?"
// =============================================================================
export const calculateDynamicEPsa = (formData, customConfig = null) => {
  const config = customConfig || DEFAULT_CALCULATOR_CONFIG;
  const { part1 } = config;

  const { errors } = validateInputs(formData, config);
  if (errors.length > 0) return null;

  const { age, race, bmi, ipss, shim, exercise, familyHistory } = formData;

  const normalizeRaceValue = (value) => String(value ?? '').trim().toLowerCase();
  const configuredRaceBlackValues = part1?.encodings?.raceBlackValues;
  const raceBlackValues =
    Array.isArray(configuredRaceBlackValues) && configuredRaceBlackValues.length > 0
      ? configuredRaceBlackValues.map(normalizeRaceValue)
      : null;

  const variableValues = {};
  const pickBinLabel = (x, bins, fallback) => {
    if (!Number.isFinite(x) || !Array.isArray(bins)) return fallback;
    for (const b of bins) {
      if (x >= b.min && x <= b.max) return b.label;
    }
    return fallback;
  };

  const ipssTotal = Array.isArray(ipss) ? ipss.reduce((a, b) => a + (b ?? 0), 0) : 0;
  const shimTotal = Array.isArray(shim) ? shim.reduce((a, b) => a + (b ?? 0), 0) : 0;

  const isBlack = raceBlackValues
    ? raceBlackValues.includes(normalizeRaceValue(race))
    : normalizeRaceValue(race) === 'black';

  const ageNum = parseInt(age, 10);

  // Age-range guard: model coefficients were derived on ages 40–75.
  // Return a minimal shell so the display layer shows the correct
  // age-out messaging without producing a meaningless score.
  if (ageNum < 40 || ageNum > 75) {
    const shellHasTwoComorbidities =
      (formData?.comorbidityScore !== undefined && formData?.comorbidityScore !== null)
        ? Number(formData.comorbidityScore) >= 2
        : [formData?.hypertension, formData?.hyperlipidemia, formData?.coronaryArteryDisease, formData?.diabetes]
            .filter((v) => v === 'yes' || v === true || v === 1).length >= 2;
    return {
      score: 0,
      guidelineTrack: { rawScore: 0, maxScore: 50, percent: 0, hasLifeExpectancyFlag: ageNum > 75, label: 'Guideline-based score (USPSTF/NCCN/AUA)', description: 'Reflects only age, race, family history, and germline mutation status — the factors directly recognized by major screening guidelines.' },
      epsaExtendedProfile: { rawScore: 0, maxScore: 80, percent: 0, label: 'ePSA extended profile', description: 'Adds lifestyle and research-based factors as contextual layers on top of the guideline-based score.' },
      // Age-gate case: outside the guideline age range — always screening_not_indicated
      // per spec ("patient is below, or grossly above, the guideline age range").
      part1Tier: {
        key: 'screening_not_indicated',
        label: 'Screening Not Indicated',
        description: 'Guideline criteria not met and no extended risk factors; patient is below, or grossly above, the guideline age range. PSA testing not warranted; no follow-up beyond routine care.',
        guidelineCriteriaMet: false,
        extendedRiskScore: 0,
        extendedRiskStrength: 'none',
        priorBiopsyHistory: formData.priorBiopsyHistory === true || formData.priorBiopsyHistory === 'yes',
      },
      age: ageNum,
      bmi: Number(bmi).toFixed(1),
      ipssTotal,
      shimTotal,
      itemImpacts: [],
      guardrailAlerts: checkGuardrails({
        psa: null,
        pirads: null,
        age: ageNum,
        highRiskFeatures: false,
        hasTwoComorbidities: shellHasTwoComorbidities,
      }, formData.pathwayMode || 'pre_psa'),
      belowMinAge: ageNum < 40,
      aboveMaxScreeningAge: ageNum > 75,
      // Age < 40: no PSA recommended per AUA/NCCN. Age > 75: requires SDM, not automatic.
      recommendPSA: ageNum < 40 ? false : null,
      epsaTierKey: 'low',
      pathwayMode: formData.pathwayMode || 'pre_psa',
      calculationDetails: { rawScore: 0, maxScore: 80 },
      modelVersion: config.version,
      skippedFields: Array.from(new Set(Array.isArray(formData.skippedFields) ? formData.skippedFields : [])),
    };
  }

  const bmiNum = parseFloat(bmi);
  const exerciseCode = Number(exercise);
  const fhBinary = familyHistory === 'unknown' ? 0 : familyHistory > 0 ? 1 : 0;
  const smokingCode = Number(formData.smoking);
  const brcaStatus = formData.brcaStatus;
  const inflammationHistory = formData.inflammationHistory;
  const chemicalExposure = formData.chemicalExposure;
  const dietPattern = formData.dietPattern;
  const hypertension = formData.hypertension;
  const hyperlipidemia = formData.hyperlipidemia;
  const coronaryArteryDisease = formData.coronaryArteryDisease;
  const diabetes = formData.diabetes;
  const comorbidityScore = formData.comorbidityScore;

  if (part1?.modelType === 'binned_v1') {
    const ageBin = pickBinLabel(ageNum, part1?.encodings?.ageBins, '40-49');
    const bmiBin = pickBinLabel(bmiNum, part1?.encodings?.bmiBins, '<25');
    const ipssSev = pickBinLabel(ipssTotal, part1?.encodings?.ipssSeverity, 'mild');
    variableValues.age_50_59 = ageBin === '50-59' ? 1 : 0;
    variableValues.age_60_69 = ageBin === '60-69' ? 1 : 0;
    variableValues.age_70_plus = ageBin === '70+' ? 1 : 0;
    variableValues.bmi_25_29_9 = bmiBin === '25-29.9' ? 1 : 0;
    variableValues.bmi_ge_30 = bmiBin === '>=30' ? 1 : 0;
    variableValues.ipss_moderate = ipssSev === 'moderate' ? 1 : 0;
    variableValues.ipss_severe = ipssSev === 'severe' ? 1 : 0;
    variableValues.exercise_some = exerciseCode === 1 ? 1 : 0;
    variableValues.exercise_none = exerciseCode === 2 ? 1 : 0;
    variableValues.raceBlack = isBlack ? 1 : 0;
    variableValues.fhBinary = fhBinary;
    variableValues.ipssTotal = ipssTotal;
    variableValues.shimTotal = shimTotal;
  } else {
    part1.variables.forEach(variable => {
      const id = variable.id;
      if (id === 'age') variableValues.age = ageNum;
      else if (id === 'raceBlack') variableValues.raceBlack = isBlack ? 1 : 0;
      else if (id === 'bmi') variableValues.bmi = bmiNum;
      else if (id === 'ipssTotal') variableValues.ipssTotal = ipssTotal;
      else if (id === 'shimTotal') variableValues.shimTotal = shimTotal;
      else if (id === 'exerciseCode') variableValues.exerciseCode = exerciseCode;
      else if (id === 'fhBinary') variableValues.fhBinary = fhBinary;
      else variableValues[id] = variableValues[id] ?? 0;
    });
  }

  // ---------------------------------------------------------------------------
  // Point-based Part 1 scoring — guideline-anchored (v2, validated against data)
  //
  // All point values are guideline- or literature-anchored. NO points were changed as a
  // result of the data run (N=100, AUC=0.562, 81% PSA>4 prevalence).
  //
  // Why data did not drive changes: the training cohort is an already-referred urology
  // population — not a general screening population. Selection bias is severe:
  //   - Age gradient non-monotonic (50s > 60s > 70s in data vs. literature)
  //   - IPSS negative (referred-for-LUTS artifact)
  //   - Family history negative (sparse positives, sign flip)
  //   - Exercise directionally consistent but cohort bias prevents calibration
  // Using this cohort to set points would systematically underweight age, IPSS, and FH.
  //
  // Scale: 16 pts per log-OR unit (age 70+ anchor). MAX_POINTS = 80.
  // The rationale field on each addImpact() call shows the data β, literature OR, and
  // the reason each value was chosen — visible in the UI "Why this score?" toggle.
  // ---------------------------------------------------------------------------
  let rawScore = 0;
  const MAX_POINTS = 80;
  const _skippedFields = new Set(Array.isArray(formData.skippedFields) ? formData.skippedFields : []);
  const itemImpacts = [];
  const addImpact = (item, value, points, fieldKey = null, rationale = null) => {
    itemImpacts.push({ item, value, points, wasSkipped: fieldKey ? _skippedFields.has(fieldKey) : false, rationale });
    rawScore += points;
  };

  // ── Age ──────────────────────────────────────────────────────────────────────
  // Data (N=100, AUC=0.562): age_50_59 β=+0.545, age_60_69 β=+0.106, age_70+ β=+0.198.
  // PROBLEM: age gradient is non-monotonic (50s > 60s) — selection bias. This cohort was
  // already referred to urology with 81% PSA>4 prevalence. Older patients had been screened
  // repeatedly; truly high-risk ones were detected earlier. Data compresses the age signal.
  // Literature (PLCO, ERSPC meta-analysis): OR age 70+ ≈ 5–8×, 60–69 ≈ 3–4×, 50–59 ≈ 1.5×.
  // Decision: use literature values. Scale anchored to age 70+ = 16 pts (1 log-OR unit).
  const AGE_RATIONALE =
    ageNum >= 70 ? { data: 'β=+0.198 (N=100) — understated. Cohort has 81% PSA>4; older patients were already screened and detected earlier, compressing the age signal.', literature: 'OR ≈ 5–8× vs <50 (PLCO, ERSPC meta-analysis). AUA/SUO 2026 Grade A, mandatory screening window.', decision: '16 pts — top of scale. Literature used; data non-monotonic (50s > 70s) due to referral bias.' } :
    ageNum >= 60 ? { data: 'β=+0.106 (N=100) — lower than 50–59 (β=+0.545), violating expected monotonicity. Selection bias artifact.', literature: 'OR ≈ 3–4× vs <50. AUA/SUO 2026 Grade A.', decision: '10 pts. Literature used; data gradient is reversed due to cohort selection.' } :
    ageNum >= 50 ? { data: 'β=+0.545 (N=100) — highest age bin, which is incorrect. Artifact of younger referred patients having acutely elevated PSA.', literature: 'OR ≈ 1.5× vs <50. AUA/SUO 2026 Grade A, core screening window begins at 50.', decision: '6 pts. Literature used; data is inflated at this bin.' } :
                   { data: 'N/A — under-50 average-risk excluded from training set.', literature: 'AUA/SUO 2026: no routine screening before age 50 for average-risk patients.', decision: '0 pts. No screening recommendation in this age group (average risk).' };
  if (ageNum >= 70) addImpact('Age', `${ageNum} years`, 16, null, AGE_RATIONALE);
  else if (ageNum >= 60) addImpact('Age', `${ageNum} years`, 10, null, AGE_RATIONALE);
  else if (ageNum >= 50) addImpact('Age', `${ageNum} years`, 6, null, AGE_RATIONALE);
  else addImpact('Age', `${ageNum} years`, 0, null, AGE_RATIONALE);

  // ── BMI ──────────────────────────────────────────────────────────────────────
  // Data (N=100): bmi_25_29.9 β=+0.982, bmi_ge_30 β=+0.533.
  // PROBLEM: overweight (25–29.9) β nearly 2× obese (≥30) — violates dose-response expectation.
  // Likely small-N artifact (few obese patients with PSA data). Literature direction is correct
  // for ≥30 but magnitude for 25–29.9 is implausible.
  // Literature (WCRF 2014 meta-analysis): OR ≈ 1.3× for BMI ≥30 for high-grade PCa.
  // Decision: apply 4 pts for ≥30 only; overweight threshold not used (data artifact).
  const BMI_RATIONALE = Number.isFinite(bmiNum) && bmiNum >= 30
    ? { data: 'β=+0.533 for BMI ≥30 (direction correct). But BMI 25–29.9 β=+0.982 > obese — violates dose-response. Small-N artifact (N=100, few obese patients with PSA data).', literature: 'OR ≈ 1.3× for BMI ≥30 for high-grade PCa (WCRF 2014 meta-analysis). Obesity threshold only.', decision: '4 pts for BMI ≥30. Overweight (25–29.9) threshold not used — data signal implausible, literature does not support it at that level.' }
    : { data: `β=+0.982 for BMI 25–29.9 in data — implausibly higher than obese (β=+0.533). Small-N artifact, not used.`, literature: 'OR ≈ 1.3× only at BMI ≥30 (WCRF 2014). No clear signal at 25–29.9.', decision: `0 pts. BMI ${Number.isFinite(bmiNum) ? bmiNum.toFixed(1) : 'N/A'} is below the obesity threshold. No additional risk assigned.` };
  if (Number.isFinite(bmiNum) && bmiNum >= 30) addImpact('BMI', bmiNum.toFixed(1), 4, null, BMI_RATIONALE);
  else addImpact('BMI', Number.isFinite(bmiNum) ? bmiNum.toFixed(1) : 'N/A', 0, null, BMI_RATIONALE);

  // ── IPSS ─────────────────────────────────────────────────────────────────────
  // Data (N=100): ipss_moderate β=−0.562, ipss_severe β=−0.096. Both NEGATIVE.
  // WHY: This cohort is a urology referral population. Many patients were referred specifically
  // because of LUTS — their PSA was measured as part of that workup, not because they had cancer.
  // High IPSS predicts referral, but NOT cancer independently in this already-referred group.
  // Literature (Ørsted & Bojesen, Nat Rev Urol. 2013;10:45–54 [corrected from prior "2015"]): LUTS OR ≈ 1.6–2× for PCa at biopsy
  // in screening populations. Mechanism: shared androgenic pathway, prostate enlargement,
  // chronic inflammation. Data sign reversal is a clear referral-bias artifact.
  // Decision: use literature value (8 pts), overriding negative data coefficient.
  const IPSS_RATIONALE = ipssTotal >= 8
    ? { data: `β=−0.562 for IPSS moderate (NEGATIVE). Patients referred to urology for LUTS had PSA measured as part of that workup — not because they had cancer. High IPSS predicts referral, not cancer independently in this already-referred cohort.`, literature: 'OR ≈ 1.6–2× for PCa at biopsy in screening populations (Ørsted & Bojesen, Nat Rev Urol 2013; ERSPC subgroup). Mechanism: shared androgenic pathway and chronic prostatic inflammation.', decision: `8 pts. Data sign is reversed due to referral bias. Literature value used — IPSS is a valid risk marker in a general screening population.` }
    : { data: `β not applicable (IPSS ${ipssTotal}/35 < 8; below moderate threshold).`, literature: 'LUTS risk contribution applies only to moderate–severe burden (IPSS ≥8).', decision: '0 pts. Mild symptoms do not add risk in this model.' };
  if (ipssTotal >= 8) addImpact('IPSS total', `${ipssTotal}/35`, 8, 'ipss', IPSS_RATIONALE);
  else addImpact('IPSS total', `${ipssTotal}/35`, 0, 'ipss', IPSS_RATIONALE);

  // ── Exercise ─────────────────────────────────────────────────────────────────
  // Data (N=100): exercise_none β=+0.419 (OR≈1.52×), exercise_some β=+0.021.
  // exercise_none is one of the most reliable data-derived values — direction and magnitude
  // are consistent across data and literature. Data OR (~1.5×) is slightly higher than the
  // Liu 2011 meta-analysis (1.2–1.3×); the conservative literature-anchored value (4 pts) is
  // kept rather than scaling up to the data's own estimate.
  // exercise_some β≈0 in data (N too small to calibrate). 2 pts kept as clinical judgment.
  // Literature: Liu Y et al. Eur Urol. 2011;60(5):1029–44 OR ≈ 1.2–1.3×. Data here stronger (1.5×).
  // Decision: 4 pts for none (literature-anchored), 2 pts for some (clinical judgment).
  // Note: data β=+0.419 for exercise_none is directionally consistent but the cohort is
  // an already-referred urology population (81% PSA>4) — not a screening population.
  // Changing points based on this biased cohort would be inappropriate; literature value kept.
  const EX_RATIONALE = exerciseCode === 2
    ? { data: 'β=+0.419 (OR≈1.52×, N=100). Directionally consistent with literature — one of the more stable signals in the data. Cohort bias noted but direction is reliable.', literature: 'OR ≈ 1.2–1.3× for sedentary behaviour vs. active (Liu et al. Eur Urol 2011 meta-analysis).', decision: '4 pts. Literature value used; data OR is slightly higher but cohort is biased toward referred patients, so conservative literature estimate preferred.' }
    : exerciseCode === 1
    ? { data: 'β=+0.021 (near-zero, N=100). Too small to calibrate this mid-tier reliably.', literature: 'No strong signal for "some" vs. "regular" exercise in meta-analyses.', decision: '2 pts. Clinical judgment: partial benefit between sedentary and active. Data does not contradict this.' }
    : { data: 'Reference category (regular exercise).', literature: 'Regular exercise associated with lower PCa risk in observational studies.', decision: '0 pts. Baseline category.' };
  if (exerciseCode === 1) addImpact('Exercise', 'Some', 2, 'exercise', EX_RATIONALE);
  else if (exerciseCode === 2) addImpact('Exercise', 'None', 4, 'exercise', EX_RATIONALE);
  else addImpact('Exercise', 'Regular', 0, 'exercise', EX_RATIONALE);

  // ── Smoking ──────────────────────────────────────────────────────────────────
  // Literature: current smoking OR ≈ 1.4× for PCa mortality, 1.1–1.2× for incidence
  // (ACS/IARC meta-analysis; Huncharek et al. 2010). Former smoking: attenuated risk.
  // 6 pts for current (≈ 38% of max age contribution), 2 pts for former.
  const SMOKE_RATIONALE = smokingCode === 2
    ? { data: 'Not in Part 1 training set (smoking not a training feature in current cohort).', literature: 'OR ≈ 1.4× for PCa mortality; 1.1–1.2× for incidence (Huncharek et al. 2010 meta-analysis; ACS/IARC). Mechanism: oxidative stress, androgen dysregulation.', decision: '6 pts. Literature-only. Consistent with ~38% of the age 70+ anchor.' }
    : smokingCode === 1
    ? { data: 'Not in training set.', literature: 'OR ≈ 1.1× for former smokers (attenuated vs. current).', decision: '2 pts. Clinical judgment — partial risk vs. current smoker (6 pts).' }
    : { data: 'Reference category.', literature: 'Never-smoker is the reference category with lowest PCa risk.', decision: '0 pts.' };
  if (smokingCode === 1) addImpact('Smoking', 'Former', 2, 'smoking', SMOKE_RATIONALE);
  else if (smokingCode === 2) addImpact('Smoking', 'Current', 6, 'smoking', SMOKE_RATIONALE);
  else addImpact('Smoking', 'Never', 0, 'smoking', SMOKE_RATIONALE);

  // ── Diet ─────────────────────────────────────────────────────────────────────
  // Literature: western / high red-meat diet OR ≈ 1.3× for high-grade PCa
  // (WCRF 2014; Bylsma & Alexander 2010). Mediterranean diet associated with lower risk.
  // 4 pts chosen (same magnitude as obesity). 'Mixed' diet treated as neutral.
  const DIET_RATIONALE = (dietPattern === 'western' || dietPattern === 'red_meat')
    ? { data: 'Not in training set (diet not a training feature in current cohort).', literature: 'OR ≈ 1.3× for high-grade PCa with western/high red-meat diet (WCRF 2014; Bylsma & Alexander 2010). Mechanism: heme iron, heterocyclic amines, IGF-1 stimulation.', decision: '4 pts. Literature-only. Same magnitude as BMI ≥30.' }
    : { data: 'Not in training set.', literature: 'No elevated risk from mixed or Mediterranean diet patterns. Mediterranean diet associated with lower PCa risk.', decision: '0 pts. Pattern does not meet western/red-meat threshold.' };
  if (dietPattern === 'western' || dietPattern === 'red_meat') addImpact('Diet pattern', String(dietPattern), 4, 'dietPattern', DIET_RATIONALE);
  else addImpact('Diet pattern', String(dietPattern || 'N/A'), 0, 'dietPattern', DIET_RATIONALE);

  // ── Race / ancestry ──────────────────────────────────────────────────────────
  // Data (N=100): raceBlack β=+0.353. Direction is correct.
  // Magnitude is lower than literature — likely because this cohort is already PSA-selected
  // (all patients had PSA measured), reducing the baseline differential.
  // Literature (SEER, ACS): Black men 1.7–2× incidence, 2.5× mortality vs. White men.
  // AUA/NCCN Grade A high-risk classification.
  // Decision: use literature-anchored 8 pts. Data β=+0.353 would yield ~3.5 pts at scale=10 —
  // too low given the well-established epidemiologic signal in unselected populations.
  const RACE_RATIONALE = isBlack
    ? { data: 'β=+0.353 (N=100). Direction is correct. Magnitude understated — cohort is already PSA-selected, which reduces the baseline differential between groups.', literature: 'OR ≈ 1.7–2× incidence, 2.5× mortality vs. White men (SEER, ACS). AUA/SUO 2026 and NCCN Grade A high-risk classification. One of the most robustly replicated PCa disparities.', decision: '8 pts. Literature used. Data β at this scale would yield only ~3.5 pts — too low given the well-established epidemiologic signal. Applied from age 40 per AUA/SUO 2026.' }
    : { data: 'N/A.', literature: 'No elevated risk for non-Black ancestry in AUA/NCCN guidelines.', decision: '0 pts.' };
  addImpact('Black ancestry', isBlack ? 'Yes' : 'No', (isBlack && ageNum >= 40) ? 8 : 0, null, RACE_RATIONALE);

  // ── Family history ────────────────────────────────────────────────────────────
  // Data (N=100): fhBinary β=−0.328. NEGATIVE — sanity check flagged this.
  // WHY: very few family history positives in N=100 (exact count unknown but sparse).
  // In a small cohort, if family history patients happen to have slightly lower PSA>4 rates
  // by chance, the coefficient flips. This is a pure small-sample artifact — the sign is wrong.
  // Literature (Carter BS et al. J Urol. 1993;150:797–802 [corrected from prior "JAMA 1993"]; Bruner et al.): OR ≈ 2.5× for
  // first-degree family history. AUA/NCCN Grade A high-risk classification. One of the
  // most robustly replicated PCa risk factors.
  // Decision: use literature (10 pts). Data coefficient is unreliable and clinically implausible.
  const FH_RATIONALE = fhBinary === 1
    ? { data: 'β=−0.328 (NEGATIVE — sanity check flagged this). Sparse positives in N=100 caused a random sign flip. Clinically implausible; this is a pure small-sample artifact.', literature: 'OR ≈ 2.5× for first-degree family history (Carter et al. J Urol 1993; Bruner et al. meta-analysis). AUA/SUO 2026 and NCCN Grade A high-risk classification. Among the most robustly replicated PCa risk factors.', decision: '10 pts. Literature overrides data. The negative data coefficient is an artifact — not a finding.' }
    : familyHistory === 'unknown'
    ? { data: 'N/A.', literature: 'Unknown status cannot be scored.', decision: '0 pts. Conservative default — unknown family history does not add risk in this model.' }
    : { data: 'N/A.', literature: 'No first-degree family history.', decision: '0 pts.' };
  addImpact('Family history', familyHistory === 'unknown' ? 'Unknown' : fhBinary === 1 ? 'Yes' : 'No', fhBinary === 1 ? 10 : 0, 'familyHistory', FH_RATIONALE);

  // ── Genetic mutation (BRCA / germline) ───────────────────────────────────────
  // Literature: BRCA2 carriers OR ≈ 3.5–8.6× for PCa; BRCA1 OR ≈ 1.8–3.3× (Castro et al.
  // JCO 2013; Kote-Jarai et al. 2011). ATM, CHEK2, Lynch syndrome also elevated.
  // 16 pts = top of the scale (same as age 70+) — strongest individual modifiable risk anchor.
  const brcaPositive = brcaStatus === 'yes' || brcaStatus === 'positive' || brcaStatus === 'lynch' || brcaStatus === 'other_elevated' || brcaStatus === 'other_unknown';
  const brcaLabel = brcaPositive ? 'Reported' : brcaStatus === 'no' ? 'None reported' : 'Not tested / Unknown';
  const BRCA_RATIONALE = brcaPositive
    ? { data: 'Not in training set (too few BRCA+ in cohort to model).', literature: 'BRCA2 OR ≈ 3.5–8.6×; BRCA1 OR ≈ 1.8–3.3× (Castro et al. JCO 2013; Kote-Jarai et al. 2011). ATM, CHEK2, Lynch syndrome also carry elevated risk.', decision: '16 pts — maximum on this scale, equal to age 70+. AUA/NCCN Grade A high-risk; screening offered from age 40.' }
    : brcaStatus === 'no'
    ? { data: 'N/A.', literature: 'No germline mutation reported.', decision: '0 pts.' }
    : { data: 'N/A.', literature: 'Untested/unknown status cannot be scored.', decision: '0 pts. Conservative default — untested status does not add risk in this model.' };
  addImpact('Genetic mutation', brcaLabel, brcaPositive ? 16 : 0, 'brcaStatus', BRCA_RATIONALE);

  // ── Expanded germline panel (HOXB13 / ATM / CHEK2 / PALB2 / Lynch-MMR) ────────
  // Literature: HOXB13 G84E OR ≈ 3.4-4.7x (Ewing et al. NEJM 2012); ATM OR ≈ 2.1-2.9x,
  // CHEK2 OR ≈ 1.9-3.0x, PALB2 OR ≈ 2.4-3.0x (Na et al. Eur Urol 2017 IMPACT/Pritchard 2016);
  // Lynch/MMR (MLH1/MSH2/MSH6/PMS2) OR ≈ 2-5x (Raymond et al. 2013; LoPC Table 4 p.13).
  // Captured separately from brcaStatus so a positive result on any panel gene (not just
  // BRCA1/2) reaches the same high-risk anchor without requiring the UI to overload the
  // single brcaStatus enum. Additive/optional — defaults to no impact if not provided.
  const germlineMutations = Array.isArray(formData.germlineMutations) ? formData.germlineMutations : [];
  const PANEL_GENES = ['hoxb13', 'atm', 'chek2', 'palb2', 'lynch', 'mlh1', 'msh2', 'msh6', 'pms2'];
  const panelPositive = germlineMutations.some((g) => PANEL_GENES.includes(String(g).toLowerCase()));
  const alreadyCountedViaBrca = brcaPositive; // avoid double-counting when brcaStatus already covers it
  const PANEL_RATIONALE = panelPositive
    ? { data: 'Not in training set.', literature: 'HOXB13 G84E OR ≈ 3.4-4.7× (Ewing et al. NEJM 2012); ATM/CHEK2/PALB2 OR ≈ 1.9-3.0× (Na et al. Eur Urol 2017; IMPACT study); Lynch/MMR OR ≈ 2-5× (Raymond et al. 2013). LoPC Table 4 (p.13) and EDPC p.13 list these as germline-testing indications alongside BRCA1/2.', decision: alreadyCountedViaBrca ? '0 additional pts — already scored via brcaStatus.' : '16 pts — same anchor as BRCA1/2, consistent with comparable or higher effect sizes in the literature.' }
    : { data: 'N/A.', literature: 'No non-BRCA germline mutation reported.', decision: '0 pts.' };
  addImpact('Expanded germline panel', panelPositive ? germlineMutations.join(', ') : 'None reported', (panelPositive && !alreadyCountedViaBrca) ? 16 : 0, 'germlineMutations', PANEL_RATIONALE);
  const germlinePositive = brcaPositive || panelPositive;

  // ── Family history of breast / ovarian / pancreatic cancer ────────────────────
  // Literature: family history of these cancers is a recognized proxy for hereditary
  // breast/ovarian cancer (HBOC) or Lynch syndrome, independent of prostate-specific
  // family history above. LoPC Table 4 (p.13): "strong personal or family history of
  // related cancers... breast, colorectal, ovarian, pancreatic, upper tract urothelial
  // carcinoma" is a germline-testing indication. EDPC p.12 corroborates for HBOC/Lynch
  // spectrum. Scored at 6 pts (below the 10 pts for direct prostate FH, since it is an
  // indirect hereditary-syndrome proxy rather than a direct prostate-cancer association).
  const hereditaryCancerFamilyHistory = Array.isArray(formData.familyHistoryCancerTypes)
    ? formData.familyHistoryCancerTypes
    : [];
  const HEREDITARY_CANCER_TYPES = ['breast', 'ovarian', 'pancreatic'];
  const hereditaryFhPositive = hereditaryCancerFamilyHistory.some((c) => HEREDITARY_CANCER_TYPES.includes(String(c).toLowerCase()));
  const HEREDITARY_FH_RATIONALE = hereditaryFhPositive
    ? { data: 'Not in training set.', literature: 'Family history of breast, ovarian, or pancreatic cancer is a recognized proxy for hereditary breast/ovarian cancer (HBOC) or Lynch syndrome (LoPC Table 4, p.13; EDPC p.12).', decision: `6 pts. Literature-only. Indirect hereditary-syndrome proxy — scored below direct prostate FH (10 pts).` }
    : { data: 'N/A.', literature: 'No reported family history of breast, ovarian, or pancreatic cancer.', decision: '0 pts.' };
  addImpact('Family history (breast/ovarian/pancreatic)', hereditaryFhPositive ? hereditaryCancerFamilyHistory.join(', ') : 'None reported', hereditaryFhPositive ? 6 : 0, 'familyHistoryCancerTypes', HEREDITARY_FH_RATIONALE);

  // ── Ashkenazi Jewish ancestry ───────────────────────────────────────────────────
  // Literature: Ashkenazi Jewish ancestry carries a substantially elevated BRCA1/2
  // founder-mutation prevalence (~1 in 40 vs ~1 in 400-800 general population), and is
  // listed as a germline-testing indication independent of confirmed mutation status
  // (LoPC Table 4, p.13: "Ashkenazi Jewish ancestry — particularly in patients with
  // Grade Group 2 or higher disease"). Scored modestly (4 pts) as an ancestry-based
  // risk-elevation flag distinct from a confirmed positive germline result.
  const ashkenaziJewish = formData.ashkenaziJewish === true || formData.ashkenaziJewish === 'yes';
  const ASHKENAZI_RATIONALE = ashkenaziJewish
    ? { data: 'Not in training set.', literature: 'Ashkenazi Jewish ancestry carries ~1 in 40 BRCA1/2 founder-mutation prevalence vs ~1 in 400-800 general population. Listed as a germline-testing indication (LoPC Table 4, p.13).', decision: '4 pts. Literature-only. Ancestry-based flag, distinct from a confirmed positive germline result.' }
    : { data: 'N/A.', literature: 'No reported Ashkenazi Jewish ancestry.', decision: '0 pts.' };
  addImpact('Ashkenazi Jewish ancestry', ashkenaziJewish ? 'Yes' : 'No', ashkenaziJewish ? 4 : 0, 'ashkenaziJewish', ASHKENAZI_RATIONALE);

  // ── Inflammation history ──────────────────────────────────────────────────────
  // Literature: prior prostatitis/prostate inflammation OR ≈ 1.6–2.0× for PCa (Dennis et al.
  // Prostate 2002; Guo & Zheng 2018 meta-analysis). Chronic inflammation drives carcinogenesis.
  // 4 pts = ~25% of max age contribution.
  const INFLAM_VAL = inflammationHistory === 1 || inflammationHistory === 'yes';
  const INFLAM_RATIONALE = INFLAM_VAL
    ? { data: 'Not in training set.', literature: 'OR ≈ 1.6–2.0× for PCa (Dennis et al. Prostate 2002; Guo & Zheng 2018 meta-analysis). Chronic inflammation drives carcinogenesis via NF-κB and ROS pathways.', decision: '4 pts. Literature-only. Same magnitude as BMI ≥30 and western diet.' }
    : { data: 'Not in training set.', literature: 'No history of prostate inflammation.', decision: '0 pts.' };
  addImpact(
    'Inflammation history',
    INFLAM_VAL ? 'Yes' : 'No',
    INFLAM_VAL ? 4 : 0,
    'inflammationHistory',
    INFLAM_RATIONALE,
  );

  // ── Chemical / 9-11 exposure ─────────────────────────────────────────────────
  // Literature: Agent Orange (dioxin) OR ≈ 1.5–2.0× for PCa (VA/IARC data; Pavuk et al.
  // 2018). 9/11 WTC dust: preliminary cohort data show elevated PCa incidence in responders
  // (Zeig-Owens et al. Lancet. 2011;378:898–905 [corrected from prior "JAMA"]). Other chemicals: heterogeneous, weaker evidence.
  // 4 pts for strong exposure, 2 pts for weak/uncertain.
  const _ce = chemicalExposure;
  const _ceStrong = _ce === 'agent_orange' || _ce === 'nine_eleven' || _ce === 'yes';
  const _ceWeak = _ce === 'other_chemical' || _ce === 'unknown';
  const _ceLabel = _ce === 'agent_orange' ? 'Agent Orange'
    : _ce === 'nine_eleven' ? '9/11 / WTC site'
    : _ce === 'other_chemical' ? 'Other chemical'
    : _ce === 'yes' ? 'Yes'
    : _ce === 'unknown' ? 'Unknown'
    : 'No';
  const CE_RATIONALE = _ceStrong
    ? { data: 'Not in training set.', literature: `Agent Orange/dioxin OR ≈ 1.5–2× (VA/IARC; Pavuk et al. 2018). 9/11 WTC responder cohort shows elevated PCa incidence (Zeig-Owens et al. Lancet 2011).`, decision: `4 pts for ${_ceLabel}. Strong epidemiologic evidence — literature-only.` }
    : _ceWeak
    ? { data: 'Not in training set.', literature: 'Weaker or heterogeneous evidence for other chemical exposures.', decision: `2 pts for ${_ceLabel}. Precautionary partial credit — evidence is uncertain but plausible.` }
    : { data: 'N/A.', literature: 'No reported chemical exposure.', decision: '0 pts.' };
  addImpact('9/11 / Chemical exposure', _ceLabel, _ceStrong ? 4 : _ceWeak ? 2 : 0, 'chemicalExposure', CE_RATIONALE);

  // ── SHIM (erectile function) ──────────────────────────────────────────────────
  // Literature: erectile dysfunction (ED) is a shared-pathway marker for prostate disease.
  // SHIM <12 (moderate–severe ED) associated with OR ≈ 1.5–1.8× for PCa at biopsy in
  // several cohorts (Esposito et al. 2008; Shim & Kim 2014). May reflect androgen deficiency
  // or vascular inflammation. 8 pts = 50% of max age contribution.
  const SHIM_RATIONALE = (shimTotal > 0 && shimTotal < 12)
    ? { data: 'Not in training set.', literature: `OR ≈ 1.5–1.8× for PCa at biopsy in patients with moderate–severe ED (Esposito et al. 2008; Shim & Kim 2014). Shared vascular and androgen-pathway mechanism.`, decision: `8 pts for SHIM ${shimTotal}/25 (moderate–severe ED). Literature-only. 50% of the age 70+ anchor.` }
    : shimTotal === 0
    ? { data: 'N/A.', literature: 'SHIM 0 = not completed or perfect function; cannot score.', decision: '0 pts.' }
    : { data: 'N/A.', literature: `SHIM ${shimTotal}/25 — mild ED or normal function. Threshold for elevated risk is SHIM < 12.`, decision: '0 pts. Below moderate–severe ED threshold.' };
  addImpact('SHIM total', `${shimTotal}/25`, (shimTotal > 0 && shimTotal < 12) ? 8 : 0, 'shim', SHIM_RATIONALE);

  // ── Comorbidity burden ────────────────────────────────────────────────────────
  // Literature: metabolic syndrome (hypertension + hyperlipidaemia + diabetes) associated
  // with OR ≈ 1.2–1.5× for high-grade PCa via insulin/IGF-1 and inflammatory pathways
  // (Esposito et al. 2013; Häggström et al. 2017). Multiple conditions = higher burden.
  // 10 pts per comorbidity tier (max 20 pts = 2 tiers). Mirrors metabolic syndrome grading.
  const isYes = (v) => v === 'yes' || v === true || v === 1;
  let comorbidityPoints = 0;
  if (comorbidityScore !== undefined && comorbidityScore !== null) {
    comorbidityPoints = Math.min(2, Math.max(0, Number(comorbidityScore))) * 10;
  } else {
    const n = [hypertension, hyperlipidemia, coronaryArteryDisease, diabetes].filter(isYes).length;
    comorbidityPoints = (n >= 2 ? 2 : n) * 10;
  }
  const COMORBID_RATIONALE = comorbidityPoints >= 20
    ? { data: 'Not in training set.', literature: 'Metabolic syndrome (≥2 of HTN, HLD, DM, CAD) OR ≈ 1.3–1.5× for high-grade PCa via insulin/IGF-1 and inflammatory pathways (Esposito et al. 2013; Häggström et al. 2017).', decision: '20 pts (maximum tier). 2+ cardiometabolic conditions. Literature-only.' }
    : comorbidityPoints === 10
    ? { data: 'Not in training set.', literature: 'Single cardiometabolic condition OR ≈ 1.2× (partial metabolic risk).', decision: '10 pts (1 condition). Literature-only.' }
    : { data: 'Not in training set.', literature: 'No cardiometabolic risk factors reported.', decision: '0 pts.' };
  addImpact('Comorbidity burden', String(comorbidityScore ?? 'derived'), comorbidityPoints, null, COMORBID_RATIONALE);

  const probability = Math.max(0, Math.min(1, rawScore / MAX_POINTS));
  const scorePercent = Math.round(probability * 100);
  const rangeLow = Math.max(0, scorePercent - 5);
  const rangeHigh = Math.min(100, scorePercent + 5);

  // ---------------------------------------------------------------------------
  // PSA recommendation threshold — Bayesian-validated operating point
  //
  // VALUE: 0.225 (22.5%) = rawScore 18 / MAX_POINTS 80
  // BASIS: Youden J = 0.138 at rawScore >= 18 (N=94, 23 csPCa)
  //        Sensitivity 91.3%, Specificity 22.5%, NPV 89.5%
  // Same boundary as the Elevated tier — intentionally aligned.
  // ---------------------------------------------------------------------------
  const recommendThreshold =
    typeof part1?.recommendThreshold === 'number' ? part1.recommendThreshold : 0.225;
  const recommendationThresholdLabel = `>= ${(recommendThreshold * 100).toFixed(0)}%`;
  const lowerProb = rangeLow / 100;
  const upperProb = rangeHigh / 100;

  // ---------------------------------------------------------------------------
  // PSA Recommendation Logic — 4-step override hierarchy
  // Steps 3-4 always win over Steps 1-2.
  // ---------------------------------------------------------------------------
  let recommendPSA = null;
  let psaRecommendReason = null;

  // Step 1 — score-based threshold
  // AUA/SUO 2026 Statement 5 (Strong, Grade B): routine screening before age 45
  // is only indicated for high-risk individuals (Black ancestry, germline mutations,
  // or strong family history). Score-threshold alone must not override this at age 40–44.
  const isHighRiskForEarlyScreening = isBlack || germlinePositive || fhBinary === 1;
  if (upperProb < recommendThreshold) {
    recommendPSA = false;
  } else if (lowerProb >= recommendThreshold) {
    if (ageNum < 45 && !isHighRiskForEarlyScreening) {
      // Average-risk age 40–44: score may be elevated but guideline does not support
      // routine PSA screening. Leave recommendPSA = null so downstream steps can assign
      // low_risk_followup or symptomatic_out_of_guideline as appropriate.
    } else {
      recommendPSA = true;
      psaRecommendReason = 'score_threshold';
    }
  }

  // Step 1.5 — Baseline PSA offered at ages 45–49 for average-risk people
  // AUA/SUO 2026 Statement 4 — Conditional Recommendation, Evidence Level: Grade B
  // "Clinicians may begin prostate cancer screening and offer a baseline PSA test to
  //  people between ages 45 to 50 years." (AUA 2026 EDPC p.11)
  // This offer applies regardless of model score — it is an age-based guideline
  // recommendation for a baseline reference value, not a risk-score threshold.
  // FIX (2026-06-02): removed prior `recommendPSA !== false` guard which incorrectly
  // blocked this offer for low-scoring 45–49 year olds.
  if (ageNum >= 45 && ageNum < 50 &&
      psaRecommendReason !== 'high_risk_early_screening') {
    recommendPSA = true;
    psaRecommendReason = 'baseline_psa_45_50';
  }

  // Step 2 — AUA regular screening window: ages 50–69 every 2–4 years
  // (Statement 6, Strong Recommendation, Evidence Level: Grade A)
  // Also overrides 'score_threshold' so the deviation banner does not fire when
  // guidelines already support PSA at this age.
  if (ageNum >= 50 && ageNum <= 69) {
    recommendPSA = true;
    if (psaRecommendReason === null || psaRecommendReason === 'baseline_psa_45_50' || psaRecommendReason === 'score_threshold') {
      psaRecommendReason = 'age_guideline_50_69';
    }
  }

  // Step 3 — High-risk early screening (always wins over Steps 1-2)
  // (Statement 5, Strong Recommendation, Evidence Level: Grade B)
  if ((isBlack || germlinePositive) && ageNum >= 40 && ageNum < 50) {
    recommendPSA = true;
    psaRecommendReason = 'high_risk_early_screening';
  }
  if ((isBlack || germlinePositive) && ageNum >= 50) {
    recommendPSA = true;
    if (['score_threshold', 'age_guideline_50_69', 'baseline_psa_45_50', null].includes(psaRecommendReason)) {
      psaRecommendReason = 'high_risk_early_screening';
    }
  }

  // Step 4 — Family history + age >= 40 (wins over Steps 1-2, yields to Step 3)
  if (fhBinary === 1 && ageNum >= 40) {
    recommendPSA = true;
    if (psaRecommendReason !== 'high_risk_early_screening') {
      psaRecommendReason = 'family_history_override';
    }
  }

  // Step 5 — Older shared decision (ages 70-75)
  // AUA/SUO 2026 Statement 7 (Conditional, Grade B) + NCCN Early Detection v1.2024 + EAU 2024:
  // Statement 7: "Clinicians may personalize the re-screening interval, or decide to
  // discontinue screening, based on patient preference, age, PSA, prostate cancer risk,
  // life expectancy, and general health following SDM." (AUA 2026 p.2)
  // NOTE: Statement 8 = DRE alongside PSA (Grade C) — not the SDM recommendation.
  // Routine PSA screening above age 70 is an individualized shared decision
  // based on overall health and life expectancy. Above 75 is handled separately
  // by the `aboveMaxScreeningAge` flag.
  // FIX (test-case audit, ePSA analysis.xlsx C06): individualized-SDM framing at 70-75
  // takes precedence over score_threshold/age_guideline_50_69/family_history_override —
  // those steps produce an assertive "recommended" framing that doesn't reflect the
  // guideline's explicit shift to individualized SDM at this age. It still yields to
  // high_risk_early_screening (Black ancestry / confirmed germline mutation remains a
  // strong guideline anchor at any age). Previously this only applied when no earlier
  // step had already claimed a reason, so family history or an elevated score would
  // silently suppress the age-70+ SDM framing entirely.
  if (ageNum >= 70 && ageNum <= 75 && psaRecommendReason !== 'high_risk_early_screening') {
    psaRecommendReason = 'older_shared_decision';
  }

  // Step 6 — Symptomatic out-of-guideline (moderate-to-severe LUTS outside
  // the standard 50-69 PSA screening window).
  // AUA/SUO BPH/LUTS guidelines define IPSS >= 8 as moderate, warranting
  // urological evaluation regardless of PSA screening age. This is a
  // referral signal — not a PSA screening recommendation per se.
  if (
    psaRecommendReason === null &&
    Number.isFinite(ipssTotal) && ipssTotal >= 8 &&
    (ageNum < 50 || ageNum > 75)
  ) {
    psaRecommendReason = 'symptomatic_out_of_guideline';
  }

  // Step 7 — Low-risk follow-up (informational, NOT a screening recommendation)
  // AUA/SUO 2026 routine re-assessment guidance: low-risk asymptomatic men
  // aged 40-44 with no high-risk anchors (Black ancestry, hereditary mutation,
  // first-degree family history) may continue routine primary care and
  // re-evaluate in 1-2 years. `recommendPSA` remains false (Step 1 default).
  if (
    psaRecommendReason === null &&
    ageNum >= 40 && ageNum < 45 &&
    rawScore <= 10 &&
    !isBlack && !germlinePositive && fhBinary !== 1
  ) {
    psaRecommendReason = 'low_risk_followup';
  }

  const PSA_RECOMMEND_MESSAGES = {
    score_threshold:
      'Your ePSA score exceeds the model\'s screening threshold. Based on the ePSA predictive model you are a candidate for PSA testing. This is an ePSA model finding (not an AUA/NCCN/EAU/ERSPC guideline recommendation). Please speak with your physician to discuss whether PSA testing is appropriate for you.',
    baseline_psa_45_50:
      'Multi-guideline support for baseline PSA at age 45–50: AUA/SUO 2026 (Conditional, Grade B), NCCN Early Detection v1.2024, EAU 2024, and ERSPC all support offering a baseline PSA in this age window for shared decision-making. A baseline PSA establishes a reference value for future comparisons. Discuss with your physician whether baseline testing is appropriate for you.',
    age_guideline_50_69:
      'Multi-guideline support for screening ages 50–69: AUA/SUO 2026 (Strong, Grade A; every 2–4 years), NCCN Early Detection v1.2024 (every 1–4 years), EAU 2024 (risk-adapted), and ERSPC (every 2–4 years). Please speak with your doctor about whether PSA testing is right for you.',
    high_risk_early_screening:
      'Due to your high-risk profile (Black ancestry or a germline mutation such as BRCA1/2, ATM, or Lynch Syndrome), multiple guidelines (AUA/SUO 2026, NCCN v1.2024, EAU 2024) recommend discussing PSA screening beginning at age 40–45 (Strong; Grade B). Please speak with your physician.',
    family_history_override:
      'Due to your strong family history of prostate cancer, multiple guidelines (AUA/SUO 2026, NCCN v1.2024, EAU 2024) recommend discussing PSA screening beginning at age 40–45 (Strong; Grade B). Please speak with your physician.',
    low_risk_followup:
      'Per AUA/SUO 2026 routine re-assessment guidance, low-risk asymptomatic men aged 40–44 with no high-risk anchors (Black ancestry, hereditary mutation, first-degree family history) may continue routine primary care without PSA screening and re-evaluate in 1–2 years. Informational — not a guideline screening recommendation. Discuss with your physician.',
    symptomatic_out_of_guideline:
      'Your urinary symptom score (IPSS ≥ 8) is in the moderate-to-severe range. Although you are outside the standard PSA screening age window (50–69), AUA/SUO BPH/LUTS guidelines recommend urological evaluation for moderate IPSS regardless of screening age. Please consult your physician or urologist.',
    older_shared_decision:
      'AUA/SUO 2026 (Statement 7) recommends individualized shared decision-making for PSA screening at ages 70–74, based on overall health and life expectancy. In very healthy patients with life expectancy ≥10 years, ongoing screening every 2–4 years is reasonable following SDM. NCCN Early Detection v1.2024 and EAU 2024 align. Discuss with your physician whether continued screening is appropriate for you.'
  };

  // Generic shared-decision-making (SDM) closing line, appended to every non-null
  // recommendation message so SDM framing is not limited to the 70-74 age bucket.
  // AUA/SUO 2026 Statement 1 (Clinical Principle): "Clinicians should engage in
  // shared decision-making (SDM) with people for whom prostate cancer screening
  // would be appropriate and proceed based on a person's values and preferences."
  const SDM_CLOSING_LINE =
    ' This result is a starting point for a conversation with your physician — not a standalone decision. ' +
    'Per AUA/SUO 2026 (Statement 1), screening decisions should be made through shared decision-making, ' +
    'reflecting your personal values and preferences.';
  const psaRecommendMessage = psaRecommendReason
    ? (PSA_RECOMMEND_MESSAGES[psaRecommendReason]
        ? PSA_RECOMMEND_MESSAGES[psaRecommendReason] + SDM_CLOSING_LINE
        : null)
    : null;

  // ---------------------------------------------------------------------------
  // Guideline support matrix — which of the four major guidelines support
  // each recommendation reason. `score_threshold` is an ePSA-model finding
  // and is explicitly NOT a guideline recommendation (0/4).
  // ---------------------------------------------------------------------------
  const PSA_GUIDELINE_SUPPORT = {
    score_threshold:              { aua: false, nccn: false, eau: false, erspc: false },
    baseline_psa_45_50:           { aua: true,  nccn: true,  eau: true,  erspc: true  },
    age_guideline_50_69:          { aua: true,  nccn: true,  eau: true,  erspc: true  },
    high_risk_early_screening:    { aua: true,  nccn: true,  eau: true,  erspc: false },
    family_history_override:      { aua: true,  nccn: true,  eau: true,  erspc: false },
    low_risk_followup:            { aua: true,  nccn: false, eau: false, erspc: false },
    symptomatic_out_of_guideline: { aua: false, nccn: false, eau: false, erspc: false },
    older_shared_decision:        { aua: true,  nccn: true,  eau: true,  erspc: false }
  };
  const psaGuidelineSupport = psaRecommendReason
    ? (PSA_GUIDELINE_SUPPORT[psaRecommendReason] || null)
    : (recommendPSA === false
        ? { aua: true, nccn: true, eau: true, erspc: true }
        : null);
  const psaGuidelineSupportCount = psaGuidelineSupport
    ? Object.values(psaGuidelineSupport).filter(Boolean).length
    : null;

  let tierRisk, tierColor, tierScoreRange;
  if (probability < part1.riskCutoffs.lower.threshold) {
    tierRisk = 'LOWER'; tierColor = part1.riskCutoffs.lower.color;
    tierScoreRange = part1.riskCutoffs.lower.label;
  } else if (probability < part1.riskCutoffs.moderate.threshold) {
    tierRisk = 'MODERATE'; tierColor = part1.riskCutoffs.moderate.color;
    tierScoreRange = part1.riskCutoffs.moderate.label;
  } else {
    tierRisk = 'HIGHER'; tierColor = part1.riskCutoffs.higher.color;
    tierScoreRange = part1.riskCutoffs.higher.label;
  }

  // Reason-keyed action text — each key maps to the specific clinical context
  // so the UI can display an accurate, guideline-attributed call-to-action.
  const PSA_ACTION_MESSAGES = {
    score_threshold:
      'ePSA model threshold met — discuss PSA testing with your physician.\n' +
      'This is an ePSA model finding; guideline screening eligibility depends on your age and risk profile.',
    baseline_psa_45_50:
      'AUA/NCCN recommend offering a baseline PSA at ages 45–49.\n' +
      'Discuss whether baseline testing is appropriate with your physician (AUA/SUO 2026 Statement 4 — Conditional, Grade B).',
    age_guideline_50_69:
      'AUA/NCCN recommend PSA screening every 2–4 years for ages 50–69.\n' +
      'Strong guideline recommendation — discuss timing and interval with your physician (AUA/SUO 2026 Statement 6 — Grade A).',
    high_risk_early_screening:
      'Due to your high-risk profile, AUA/NCCN recommend discussing PSA screening from age 40–45.\n' +
      'Discuss PSA testing with your physician (AUA/SUO 2026 Statement 5 — Strong, Grade B).',
    family_history_override:
      'Due to your family history of prostate cancer, AUA/NCCN recommend discussing PSA screening from age 40–45.\n' +
      'Discuss PSA testing with your physician (AUA/SUO 2026 Statement 5 — Strong, Grade B).',
    older_shared_decision:
      'Shared Decision-Making (SDM) is recommended for PSA screening at ages 70–74.\n' +
      'Discuss your overall health, life expectancy, and personal preferences with your physician (AUA/SUO 2026 Statement 7 — Conditional, Grade B).',
    symptomatic_out_of_guideline:
      'Your urinary symptoms (IPSS ≥ 8) suggest urological evaluation is warranted.\n' +
      'This is a symptom-based referral signal, not a routine PSA screening recommendation — discuss with your physician.',
    low_risk_followup:
      'Low ePSA score with no high-risk factors — routine primary care applies.\n' +
      'Re-assess in 1–2 years per AUA/SUO 2026 guidance (no screening recommendation at this time).',
  };

  let risk, color, action, scoreRange;
  if (recommendPSA === true) {
    risk = 'PSA_RECOMMENDED'; color = '#D4AF37';
    scoreRange = `>= ${(recommendThreshold * 100).toFixed(0)}%`;
    action = PSA_ACTION_MESSAGES[psaRecommendReason] ?? 'Discuss PSA testing with your physician.';
  } else if (recommendPSA === false) {
    risk = 'PSA_NOT_RECOMMENDED'; color = '#27AE60';
    scoreRange = `< ${(recommendThreshold * 100).toFixed(0)}%`;
    action = 'Routine screening.\nFollow standard age-based screening guidance.';
  } else {
    risk = tierRisk; color = tierColor; scoreRange = tierScoreRange;
    if (tierRisk === 'HIGHER') action = 'PSA testing and urological evaluation are recommended.';
    else if (tierRisk === 'MODERATE') action = 'PSA blood testing recommended.\nDiscuss PSA testing with your doctor.';
    else action = 'Routine screening.\nFollow standard age-based screening guidance.';
  }

  // ---------------------------------------------------------------------------
  // ePSA Risk Tier — 3-tier system (v2)
  // Low (≤10) | Intermediate (11-17) | Elevated (≥18)
  // Boundary at 18 = Youden-optimal threshold (J=0.138, sens=91.3%)
  // ---------------------------------------------------------------------------
  const EPSA_TIER_DEFS = [
    {
      key: 'low', label: 'Low — Routine Screening', scoreRange: 'score 0-10', normalizedRange: '<= 12.5%',
      guideline: 'Your ePSA score is in the low range. The model indicates a low likelihood of an abnormal PSA result. Routine screening timeline applies. Discuss with your physician.',
      // Empirical: 7% csPCa rate [1%-31%] N=14
      empiricalRate: EPSA_TIER_CALIBRATION.low
    },
    {
      key: 'intermediate', label: 'Intermediate — Consider PSA Discussion', scoreRange: 'score 11-17', normalizedRange: '13.75%-21.25%',
      guideline: 'Your ePSA score is in the intermediate range. Based on this model score, PSA testing may be appropriate — this is an ePSA model-based finding, not an AUA/NCCN/EAU/ERSPC guideline recommendation. Speak with your physician.',
      empiricalRate: EPSA_TIER_CALIBRATION.intermediate
    },
    {
      key: 'elevated', label: 'Strong Candidate for PSA Testing', scoreRange: 'score >= 18', normalizedRange: '>= 22.5%',
      guideline: 'Your ePSA score suggests an elevated likelihood of an abnormal PSA test. Based on this model score, PSA testing is strongly suggested — this is an ePSA model-based finding, not an AUA/NCCN/EAU/ERSPC guideline recommendation. Please speak with your physician promptly.',
      empiricalRate: EPSA_TIER_CALIBRATION.elevated
    }
  ];

  let epsaTierIndex;
  if (rawScore <= 10) epsaTierIndex = 0;
  else if (rawScore <= 17) epsaTierIndex = 1;
  else epsaTierIndex = 2;

  const epsaTierDef = EPSA_TIER_DEFS[epsaTierIndex];
  const hasTwoComorbidities =
    (comorbidityScore !== undefined && comorbidityScore !== null)
      ? Number(comorbidityScore) >= 2
      : comorbidityPoints >= 20;

  const highRiskAnchors = {
    age70plus: ageNum >= 70,
    blackRace: isBlack,
    familyHistory: fhBinary > 0,
    brca: germlinePositive,
    twoComorbidities: hasTwoComorbidities
  };
  const hasHighRiskAnchor = Object.values(highRiskAnchors).some((v) => v === true);
  const isHighRiskFlagged = rawScore >= 18 && hasHighRiskAnchor;

  // ---------------------------------------------------------------------------
  // Empirical probability display — return data fields only.
  // UI renders the sentence via i18n (`part1Results.empiricalProbabilityText`)
  // so it translates correctly across locales.
  // ---------------------------------------------------------------------------
  const cal = epsaTierDef.empiricalRate;
  const empiricalProbabilityText = null; // deprecated — kept for callers that null-check; UI builds string via i18n

  const guardrailAlerts = checkGuardrails({
    psa: null,
    pirads: null,
    age: ageNum,
    highRiskFeatures: hasHighRiskAnchor,
    hasTwoComorbidities,
  }, formData.pathwayMode || 'pre_psa');

  // ---------------------------------------------------------------------------
  // Part 1 output-statement tiers (product spec, 4 tiers) — screening_not_indicated /
  // discussion_optional / discussion_advised_extended_risk / screening_recommended.
  //
  // "Guideline criteria met" reuses the SAME psaRecommendReason values already
  // classified above as guideline-backed (see PSA_GUIDELINE_SUPPORT — these are
  // the reasons with >0 guideline support, i.e. AUA/SUO 2026 Statements 4/5/6/7,
  // already cited inline where psaRecommendReason is assigned). 'score_threshold'
  // is deliberately excluded — it is explicitly an ePSA-model-only finding (0/4
  // guideline support, see PSA_GUIDELINE_SUPPORT.score_threshold above), not a
  // guideline criterion.
  //
  // "Extended (ePSA) risk factors" = the factors the product spec names as
  // beyond the guideline definition: family history of breast/ovarian/pancreatic
  // cancer (hereditaryFhPositive, HBOC/Lynch proxy — LoPC Table 4 p.13; EDPC
  // p.12, already cited above), non-BRCA germline panel result (panelPositive —
  // HOXB13/ATM/CHEK2/PALB2/Lynch-MMR, Ewing et al. NEJM 2012; Na et al. Eur Urol
  // 2017; Raymond et al. 2013, already cited above), Ashkenazi Jewish ancestry
  // (ashkenaziJewish — BRCA1/2 founder-mutation prevalence, LoPC Table 4 p.13,
  // already cited above), and prior biopsy history (new field below).
  // NOTE: brcaStatus (confirmed BRCA1/2) and direct prostate family history are
  // already part of this engine's `guidelineTrack` (see GUIDELINE_TRACK_ITEMS
  // above) — they count toward "guideline criteria met", not extended risk,
  // consistent with how this codebase already partitions guideline vs.
  // lifestyle/extended factors (see guidelineTrack/epsaExtendedProfile comment
  // block above).
  // ---------------------------------------------------------------------------
  const priorBiopsyHistory =
    formData.priorBiopsyHistory === true || formData.priorBiopsyHistory === 'yes';
  // Prior (esp. negative) biopsy history is a recognized input to repeat-biopsy /
  // continued-surveillance decisions distinct from first-time screening criteria
  // (NCCN Prostate Cancer Early Detection v1.2024 — repeat-biopsy risk factors;
  // AUA/SUO 2026 EDPC discussion of biopsy history as a risk-modifying context).
  // Scored here only for the Part 1 extended-risk tier classification below —
  // intentionally NOT added to rawScore/MAX_POINTS so MAX_POINTS stays 80 and no
  // existing score-based test or downstream consumer is affected.
  const PRIOR_BIOPSY_POINTS = priorBiopsyHistory ? 6 : 0; // same magnitude as hereditaryFhPositive (6 pts) — both indirect/contextual proxies, not direct guideline anchors

  const GUIDELINE_MET_REASONS = new Set([
    'age_guideline_50_69', 'baseline_psa_45_50', 'high_risk_early_screening',
    'family_history_override', 'older_shared_decision',
  ]);
  const guidelineCriteriaMet = GUIDELINE_MET_REASONS.has(psaRecommendReason);

  // Extended-risk composite score (tier classification only — separate from rawScore).
  const extendedRiskScore =
    (hereditaryFhPositive ? 6 : 0) +
    (ashkenaziJewish ? 4 : 0) +
    ((panelPositive && !alreadyCountedViaBrca) ? 16 : 0) +
    PRIOR_BIOPSY_POINTS;
  // "Strong" vs "limited" extended risk — a composite judgment call the spec asks
  // us to make from the file's own literature-anchored point weights (see task
  // instructions: "use existing point/scoring weights ... use a reasonable
  // threshold on the existing score"). Threshold set at 10 pts = half of the
  // single strongest extended-only anchor (non-BRCA germline panel positive,
  // 16 pts — Ewing et al. NEJM 2012; Na et al. Eur Urol 2017; Raymond et al.
  // 2013), so a germline panel result alone is always "strong", and so is any
  // combination reaching that weight (e.g. hereditary-cancer FH + Ashkenazi
  // ancestry = 6+4 = 10 pts, both anchored to LoPC Table 4 p.13 / EDPC p.12-13).
  // A single weaker proxy alone (e.g. Ashkenazi ancestry only, 4 pts) is "limited".
  const EXTENDED_RISK_STRONG_THRESHOLD = 10;
  const extendedRiskStrength = extendedRiskScore === 0
    ? 'none'
    : extendedRiskScore >= EXTENDED_RISK_STRONG_THRESHOLD
      ? 'strong'
      : 'limited';

  const PART1_TIER_DEFS = {
    screening_not_indicated: {
      label: 'Screening Not Indicated',
      description: 'Guideline criteria not met and no extended risk factors; patient is below, or grossly above, the guideline age range. PSA testing not warranted; no follow-up beyond routine care.',
    },
    discussion_optional: {
      label: 'Discussion Optional',
      description: 'Guideline criteria not met, but limited extended risk factors are present. Offer shared decision-making — PSA is a reasonable option if the patient values early detection after discussing benefits and harms.',
    },
    discussion_advised_extended_risk: {
      label: 'Discussion Advised (Extended Risk)',
      description: 'Guideline criteria not met, but strong extended risk factors argue for screening (family history beyond the guideline definition, DDR/germline panel, prior biopsy history, ancestry). Actively recommend a screening discussion and consider PSA.',
    },
    screening_recommended: {
      label: 'Screening Recommended',
      description: 'Guideline criteria met (USPSTF, AUA, NCCN). Proceed to baseline PSA and set the testing interval according to result and risk profile.',
    },
  };

  let part1TierKey;
  if (guidelineCriteriaMet) {
    part1TierKey = 'screening_recommended';
  } else if (ageNum < 40 || ageNum > 75) {
    part1TierKey = 'screening_not_indicated';
  } else if (extendedRiskStrength === 'strong') {
    part1TierKey = 'discussion_advised_extended_risk';
  } else if (extendedRiskStrength === 'limited') {
    part1TierKey = 'discussion_optional';
  } else {
    part1TierKey = 'screening_not_indicated';
  }
  const part1Tier = {
    key: part1TierKey,
    label: PART1_TIER_DEFS[part1TierKey].label,
    description: PART1_TIER_DEFS[part1TierKey].description,
    guidelineCriteriaMet,
    extendedRiskScore,
    extendedRiskStrength,
    priorBiopsyHistory,
  };

  // ---------------------------------------------------------------------------
  // Guideline-based score (two-track output) — a clean subset of the full
  // rawScore containing only USPSTF/NCCN/AUA-recognized screening factors: age,
  // race, family history, and germline mutations (BRCA1/2 + expanded panel).
  // Purely additive/derived from itemImpacts already computed above — does not
  // change rawScore, score, epsaTierIndex, or any existing recommendation logic.
  // Lifestyle/research-based factors (BMI, smoking, diet, exercise, SHIM, IPSS,
  // comorbidities, inflammation, chemical exposure, Ashkenazi ancestry, non-
  // prostate cancer family history) remain in the full score as the separate
  // "ePSA extended profile" layer — i.e. everything already on the main result.
  // The life-expectancy gate is surfaced as a flag (categorical), not a point
  // deduction, since it modifies screening benefit, not cancer probability.
  // ---------------------------------------------------------------------------
  const GUIDELINE_TRACK_ITEMS = new Set(['Age', 'Black ancestry', 'Family history', 'Genetic mutation', 'Expanded germline panel']);
  const GUIDELINE_TRACK_MAX_POINTS = 50; // Age(16) + Black ancestry(8) + Family history(10) + Genetic mutation(16, BRCA/panel deduplicated)
  const guidelineTrackRawScore = itemImpacts
    .filter((i) => GUIDELINE_TRACK_ITEMS.has(i.item))
    .reduce((sum, i) => sum + (Number(i.points) || 0), 0);
  const guidelineTrack = {
    rawScore: guidelineTrackRawScore,
    maxScore: GUIDELINE_TRACK_MAX_POINTS,
    percent: Math.round(Math.max(0, Math.min(1, guidelineTrackRawScore / GUIDELINE_TRACK_MAX_POINTS)) * 100),
    hasLifeExpectancyFlag: guardrailAlerts.some((a) => a.code === 'LIFE_EXPECTANCY_GATE'),
    label: 'Guideline-based score (USPSTF/NCCN/AUA)',
    description: 'Reflects only age, race, family history, and germline mutation status — the factors directly recognized by major screening guidelines.',
  };
  const epsaExtendedProfile = {
    rawScore,
    maxScore: MAX_POINTS,
    percent: scorePercent,
    label: 'ePSA extended profile',
    description: 'Adds lifestyle and research-based factors (BMI, smoking, diet, exercise, SHIM, IPSS, comorbidities, and others) as contextual layers on top of the guideline-based score. Contextualizes but does not override the guideline-based recommendation.',
  };

  return {
    // Provenance — used by the results meta-bar for audit/citation
    computedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    // Two-track output (additive — see guidelineTrack/epsaExtendedProfile above)
    guidelineTrack,
    epsaExtendedProfile,
    // Part 1 output-statement tier (product spec, 4 tiers) — see PART1_TIER_DEFS above
    part1Tier,
    // Core score
    score: scorePercent,
    scoreRange,
    recommendationThresholdLabel,
    confidenceRange: `${rangeLow}%-${rangeHigh}%`,
    confidenceLow: rangeLow,
    confidenceHigh: rangeHigh,

    // PSA recommendation
    risk,
    color,
    action: epsaTierDef.guideline,
    recommendPSA,
    psaRecommendReason,
    psaRecommendMessage,
    psaGuidelineSupport,
    psaGuidelineSupportCount,
    sdmGuide: buildShareModelGuide({ psaRecommendReason, recommendPSA }),

    // Legacy tier fields
    tierRisk,
    tierColor,
    tierScoreRange,

    // 3-tier classification
    epsaTierIndex,
    epsaTierKey: epsaTierDef.key,
    epsaTierLabel: epsaTierIndex === 2 ? 'Strong candidate for PSA testing' : epsaTierDef.label,
    tierDrivenByNonGuidelineFactors: false,
    epsaTierScoreRange: epsaTierDef.scoreRange,
    epsaTierNormalizedRange: epsaTierDef.normalizedRange,
    epsaTierBoundaries: { lowMax: 10, intermediateMax: 17, maxScore: MAX_POINTS },

    // Empirical calibration
    empiricalProbabilityText,
    empiricalRate: cal?.rate ?? null,
    empiricalRateCiLo: cal?.ci_lo ?? null,
    empiricalRateCiHi: cal?.ci_hi ?? null,
    empiricalRateN: cal?.n ?? null,
    empiricalRateEvents: cal?.events ?? null,

    // Risk factors
    isHighRiskFlagged,
    highRiskAnchors,
    itemImpacts,

    // Pass-through fields for Model 2/3/4
    isBlack,
    fhBinary,
    brcaStatus,
    bmi: Number(bmi).toFixed(1),
    age: parseInt(age, 10),
    ipssTotal: ipssTotal,
    shimTotal: shimTotal,

    // Age eligibility
    belowMinAge: ageNum < 40,
    aboveMaxScreeningAge: ageNum > 75,

    // Guardrails
    guardrailAlerts,

    // Metadata
    epsaGuidelineText: epsaTierDef.guideline,
    modelVersion: config.version,
    displayRange: `${rangeLow}%-${rangeHigh}%`,
    pathwayMode: formData.pathwayMode || 'pre_psa',
    calculationDetails: { probability, rawScore, maxScore: MAX_POINTS },
    skippedFields: Array.from(_skippedFields),
  };
};

// =============================================================================
// Shared Decision-Making (SDM) conversation guide — AHRQ SHARE Approach
// (Seek, Help, Assess, Reach, Evaluate; 2014-2024): https://www.ahrq.gov/sdm/share-approach/index.html
// Structures the recommendation reason into a "prepare for your visit" guide
// instead of a single generic sentence (SDM_CLOSING_LINE, above). Purely
// additive — does not change psaRecommendReason, psaRecommendMessage, or any
// existing message content; returns null when there is nothing to discuss.
// =============================================================================
const SHARE_GUIDE_CONTENT = {
  score_threshold: {
    topic: 'Whether to pursue PSA testing based on your ePSA model score',
    seekPrompt: 'This is a model-flagged discussion, not a guideline mandate — none of the four major guidelines (AUA/SUO, NCCN, EAU, ERSPC) recommend PSA testing based on your age/risk profile alone. Ask your physician to walk through why the ePSA model flagged your score.',
    helpPrompt: 'Explore your real options for what happens next.',
    helpOptions: ['Get PSA testing now', 'Wait and re-assess later', 'Decline testing for now'],
    assessPrompt: 'Talk through what matters most to you before deciding.',
    considerations: ['Your comfort with a false-positive-prone score', 'Any family history of prostate cancer', 'Your preference for watchful waiting vs. testing now'],
    reachPrompt: 'Reach a decision together with your physician that reflects your values, not just the model output.',
    evaluatePrompt: 'Revisit this decision at your next visit — the model finding may change as new information comes in.',
    guidelineCitation: 'ePSA model finding (0/4 guideline support: AUA/SUO, NCCN, EAU, ERSPC).',
  },
  baseline_psa_45_50: {
    topic: 'Whether to get a baseline PSA now',
    seekPrompt: 'This is about establishing a reference value for future comparisons, not urgency — ask your physician what a baseline PSA would mean for your future screening plan.',
    helpPrompt: 'Compare your real options.',
    helpOptions: ['Get a baseline PSA now', 'Wait until age 50', 'Decline baseline testing'],
    assessPrompt: 'Consider how much a future comparison point is worth to you.',
    considerations: ['How much you value having a reference PSA value later', 'Family history of prostate cancer', 'Your general comfort with testing now vs. later'],
    reachPrompt: 'Decide together whether a baseline value now is worth it for you.',
    evaluatePrompt: 'If you decline now, revisit this at age 50 when routine screening begins.',
    guidelineCitation: 'AUA/SUO 2026 (Conditional, Grade B); NCCN Early Detection v1.2024; EAU 2024; ERSPC.',
  },
  age_guideline_50_69: {
    topic: 'Starting or continuing routine PSA screening',
    seekPrompt: 'This is a routine, strongly-recommended discussion at your age — ask your physician about starting or continuing PSA screening.',
    helpPrompt: 'Review your options for this screening cycle.',
    helpOptions: ['Test now', 'Discuss a 2-4 year interval', 'Decline this cycle'],
    assessPrompt: 'Consider your own history and health before deciding.',
    considerations: ['Your prior PSA history, if any', 'Comorbidities that may affect life expectancy', 'Your general comfort with routine screening'],
    reachPrompt: 'Reach a decision on testing and interval together with your physician.',
    evaluatePrompt: 'Re-evaluate at your next routine visit, typically in 2-4 years.',
    guidelineCitation: 'AUA/SUO 2026 (Strong, Grade A; every 2-4 years); NCCN Early Detection v1.2024; EAU 2024; ERSPC.',
  },
  high_risk_early_screening: {
    topic: 'Starting PSA screening early due to your high-risk profile',
    seekPrompt: 'Your Black ancestry and/or a germline mutation (BRCA1/2, ATM, Lynch Syndrome) is the specific reason to discuss earlier screening — ask your physician how this affects your personal risk and timeline.',
    helpPrompt: 'Explore your options given this elevated risk.',
    helpOptions: ['Start screening now', 'Discuss timing with a specialist first', 'Decline for now'],
    assessPrompt: 'Talk through your risk history in detail.',
    considerations: ['Detailed family cancer history', 'Whether you have had genetic counseling', 'Whether you have discussed hereditary risk with anyone before'],
    reachPrompt: 'Reach a decision on timing together, informed by your specific risk factors.',
    evaluatePrompt: 'Revisit at the agreed interval, or sooner if new family history emerges.',
    guidelineCitation: 'AUA/SUO 2026, NCCN v1.2024, EAU 2024 (Strong; Grade B).',
  },
  family_history_override: {
    topic: 'Starting PSA screening early due to your family history',
    seekPrompt: 'Your strong family history of prostate cancer is the specific reason to discuss earlier screening — ask your physician how this affects your personal risk and timeline.',
    helpPrompt: 'Explore your options given this family history.',
    helpOptions: ['Start screening now', 'Discuss timing with a specialist first', 'Decline for now'],
    assessPrompt: 'Talk through which relatives were affected and when.',
    considerations: ['Which relatives were diagnosed with prostate cancer', 'The age at which they were diagnosed', 'Whether genetic counseling has been discussed'],
    reachPrompt: 'Reach a decision on timing together, informed by your family history.',
    evaluatePrompt: 'Revisit at the agreed interval, or sooner if new family history emerges.',
    guidelineCitation: 'AUA/SUO 2026, NCCN v1.2024, EAU 2024 (Strong; Grade B).',
  },
  older_shared_decision: {
    topic: 'Whether to continue PSA screening at your age',
    seekPrompt: 'At this age the conversation should start with your overall health and life expectancy, not the PSA score itself — ask your physician how they weigh those factors for you specifically.',
    helpPrompt: 'Weigh all of your options, including stopping screening.',
    helpOptions: ['Continue screening every 2-4 years', 'Discontinue screening', 'Test once more and reassess'],
    assessPrompt: 'Consider your overall health picture, not just this score.',
    considerations: ['Comorbidities and overall functional status', 'Your own view on further cancer workup or treatment at this life stage', 'Whether you have a life expectancy of 10+ years'],
    reachPrompt: 'Reach a decision together that reflects your health status and personal preferences, including the option to stop.',
    evaluatePrompt: 'Revisit this decision at each visit as your health status evolves.',
    guidelineCitation: 'AUA/SUO 2026 (Statement 7, Conditional, Grade B); NCCN Early Detection v1.2024; EAU 2024.',
  },
  symptomatic_out_of_guideline: {
    topic: 'A urinary-symptom evaluation — not a PSA screening recommendation',
    seekPrompt: 'This is a referral for your urinary symptoms, explicitly not a PSA screening recommendation — ask your physician or urologist to evaluate your symptoms separately from screening.',
    helpPrompt: 'Explore what a symptom evaluation would involve.',
    helpOptions: ['Schedule a urological evaluation', 'Discuss symptom management first', 'Wait and monitor symptoms'],
    assessPrompt: 'Talk through how your symptoms are affecting you.',
    considerations: ['Your symptom burden and bother (IPSS)', 'Impact on your day-to-day quality of life'],
    reachPrompt: 'Reach a decision on next steps for your symptoms together.',
    evaluatePrompt: 'Revisit if symptoms change or do not improve after the agreed plan.',
    guidelineCitation: 'AUA/SUO BPH/LUTS guidelines (IPSS >= 8 warrants urological evaluation).',
  },
  low_risk_followup: {
    topic: 'Confirming that no action is needed right now',
    seekPrompt: 'This is a "no action needed now" conversation — ask your physician to confirm routine primary care is appropriate and when to revisit.',
    helpPrompt: 'Confirm your plan for the next 1-2 years.',
    helpOptions: ['Continue routine primary care', 'Revisit in 1-2 years'],
    assessPrompt: 'Use this visit to get reassurance and know when to come back.',
    considerations: ['Reassurance that no high-risk anchors are present', 'When to return for re-evaluation'],
    reachPrompt: 'Confirm together that routine follow-up is the right plan for now.',
    evaluatePrompt: 'Revisit in 1-2 years, or sooner if new risk factors emerge.',
    guidelineCitation: 'AUA/SUO 2026 routine re-assessment guidance.',
  },
  not_recommended: {
    topic: 'Whether to talk about PSA testing at all right now',
    seekPrompt: 'Would you like to talk about PSA testing at all right now? There is no specific reason flagged for you today.',
    helpPrompt: 'Routine age-based screening guidance applies.',
    helpOptions: ['Discuss routine screening timeline', 'Not right now'],
    assessPrompt: 'Raise any concerns you have, even if nothing was flagged.',
    considerations: ['Any patient-initiated concerns about prostate cancer risk'],
    reachPrompt: 'Decide together whether there is anything worth discussing now.',
    evaluatePrompt: 'Revisit at your next routine visit.',
    guidelineCitation: 'Routine age-based screening guidance.',
  },
  // Model 3 — MRI recommendation reasons (take priority over Model 1 reasons)
  psa_elevated: {
    topic: 'Whether to get an mpMRI before biopsy',
    seekPrompt: 'Your elevated PSA is the reason an mpMRI is being discussed before any biopsy decision — ask your physician what the MRI would add here.',
    helpPrompt: 'Compare your real options at this stage.',
    helpOptions: ['mpMRI before biopsy', 'Biopsy without MRI', 'Watchful waiting'],
    assessPrompt: 'Consider what matters most to you at this stage of the pathway.',
    considerations: ['Your comfort with additional imaging before biopsy', 'How your PSA has trended over time', 'Your overall risk tolerance'],
    reachPrompt: 'Reach a decision together on imaging vs. proceeding directly.',
    evaluatePrompt: 'Revisit based on the MRI result, if you choose imaging.',
    guidelineCitation: 'AUA 2026 Statement 13 (Grade A).',
  },
  combined_risk_elevated: {
    topic: 'Whether to get an mpMRI before biopsy',
    seekPrompt: 'Your combined risk profile is elevated, which is why an mpMRI is being discussed before any biopsy decision — ask your physician what the MRI would add here.',
    helpPrompt: 'Compare your real options at this stage.',
    helpOptions: ['mpMRI before biopsy', 'Biopsy without MRI', 'Watchful waiting'],
    assessPrompt: 'Consider what matters most to you at this stage of the pathway.',
    considerations: ['Your comfort with additional imaging before biopsy', 'The combination of factors driving this risk estimate', 'Your overall risk tolerance'],
    reachPrompt: 'Reach a decision together on imaging vs. proceeding directly.',
    evaluatePrompt: 'Revisit based on the MRI result, if you choose imaging.',
    guidelineCitation: 'AUA 2026 (combined-risk pathway).',
  },
  high_risk_profile: {
    topic: 'Whether to get an mpMRI before biopsy',
    seekPrompt: 'Your high-risk profile is the reason an mpMRI is being discussed before any biopsy decision — ask your physician what the MRI would add here.',
    helpPrompt: 'Compare your real options at this stage.',
    helpOptions: ['mpMRI before biopsy', 'Biopsy without MRI', 'Watchful waiting'],
    assessPrompt: 'Consider what matters most to you at this stage of the pathway.',
    considerations: ['Your comfort with additional imaging before biopsy', 'The specific risk anchors present in your profile', 'Your overall risk tolerance'],
    reachPrompt: 'Reach a decision together on imaging vs. proceeding directly.',
    evaluatePrompt: 'Revisit based on the MRI result, if you choose imaging.',
    guidelineCitation: 'AUA 2026 (high-risk pathway).',
  },
  discordance: {
    topic: 'Whether to get an mpMRI before biopsy',
    seekPrompt: 'Your ePSA profile is notably higher than your PSA alone suggests, which is why an mpMRI is being discussed before any biopsy decision — ask your physician what is driving this discordance.',
    helpPrompt: 'Compare your real options at this stage.',
    helpOptions: ['mpMRI before biopsy', 'Biopsy without MRI', 'Watchful waiting'],
    assessPrompt: 'Consider what matters most to you at this stage of the pathway.',
    considerations: ['Your comfort with additional imaging before biopsy', 'What might explain the discordance between PSA and ePSA', 'Your overall risk tolerance'],
    reachPrompt: 'Reach a decision together on imaging vs. proceeding directly.',
    evaluatePrompt: 'Revisit based on the MRI result, if you choose imaging.',
    guidelineCitation: 'AUA/NCCN guidelines (discordance pathway).',
  },
  // Model 3 — biopsy recommendation reasons (take priority over MRI/Model 1 reasons)
  pirads_5: {
    topic: 'Whether to proceed with a prostate biopsy',
    seekPrompt: 'Your PI-RADS 5 finding is the reason biopsy is being discussed — ask your physician to walk through what this specific finding means and what a biopsy would involve.',
    helpPrompt: 'Explore and compare your options — biopsy is not the only path even with a guideline-backed finding.',
    helpOptions: ['Proceed with biopsy', 'Repeat imaging first', 'Watchful waiting'],
    assessPrompt: 'Weigh the risks of biopsy alongside its benefit.',
    considerations: ['Risk of infection from the procedure', 'Risk of detecting an indolent cancer that may never need treatment', 'Your personal risk tolerance'],
    reachPrompt: 'Reach a decision together that reflects your values, not just the finding.',
    evaluatePrompt: 'Revisit the plan based on biopsy results, if you proceed.',
    guidelineCitation: 'AUA/NCCN guidelines (PI-RADS 5).',
  },
  pirads_4: {
    topic: 'Whether to proceed with a prostate biopsy',
    seekPrompt: 'Your PI-RADS 4 finding is the reason biopsy is being discussed — ask your physician to walk through what this specific finding means and what a biopsy would involve.',
    helpPrompt: 'Explore and compare your options — biopsy is not the only path even with a guideline-backed finding.',
    helpOptions: ['Proceed with biopsy', 'Repeat imaging first', 'Watchful waiting'],
    assessPrompt: 'Weigh the risks of biopsy alongside its benefit.',
    considerations: ['Risk of infection from the procedure', 'Risk of detecting an indolent cancer that may never need treatment', 'Your personal risk tolerance'],
    reachPrompt: 'Reach a decision together that reflects your values, not just the finding.',
    evaluatePrompt: 'Revisit the plan based on biopsy results, if you proceed.',
    guidelineCitation: 'AUA/NCCN guidelines (PI-RADS 4).',
  },
  combined_score_high: {
    topic: 'Whether to proceed with a prostate biopsy',
    seekPrompt: 'Your combined risk score is high, which is why biopsy is being discussed — ask your physician to walk through what is driving this score and what a biopsy would involve.',
    helpPrompt: 'Explore and compare your options — biopsy is not the only path even with a guideline-backed finding.',
    helpOptions: ['Proceed with biopsy', 'Repeat imaging first', 'Watchful waiting'],
    assessPrompt: 'Weigh the risks of biopsy alongside its benefit.',
    considerations: ['Risk of infection from the procedure', 'Risk of detecting an indolent cancer that may never need treatment', 'Your personal risk tolerance'],
    reachPrompt: 'Reach a decision together that reflects your values, not just the score.',
    evaluatePrompt: 'Revisit the plan based on biopsy results, if you proceed.',
    guidelineCitation: 'AUA/NCCN guidelines (combined high-risk score).',
  },
  high_risk_discordance: {
    topic: 'Whether to proceed with a prostate biopsy',
    seekPrompt: 'A discordance between your high-risk profile and imaging is the reason biopsy is being discussed — ask your physician to walk through what is driving this and what a biopsy would involve.',
    helpPrompt: 'Explore and compare your options — biopsy is not the only path even with a guideline-backed finding.',
    helpOptions: ['Proceed with biopsy', 'Repeat imaging first', 'Watchful waiting'],
    assessPrompt: 'Weigh the risks of biopsy alongside its benefit.',
    considerations: ['Risk of infection from the procedure', 'Risk of detecting an indolent cancer that may never need treatment', 'Your personal risk tolerance'],
    reachPrompt: 'Reach a decision together that reflects your values, not just the discordance.',
    evaluatePrompt: 'Revisit the plan based on biopsy results, if you proceed.',
    guidelineCitation: 'AUA/NCCN guidelines (high-risk discordance).',
  },
};

// AHRQ SHARE Approach (2014-2024): 5-step framework for shared decision-making.
// https://www.ahrq.gov/sdm/share-approach/index.html
// Returns null when there is nothing to discuss (no reason assigned at all).
function buildShareModelGuide({ psaRecommendReason, recommendPSA, mriRecommendReason, biopsyReason }) {
  const CONTENT = SHARE_GUIDE_CONTENT;
  const key = biopsyReason || mriRecommendReason || psaRecommendReason
    || (recommendPSA === false ? 'not_recommended' : null);
  if (!key || !CONTENT[key]) return null;
  const c = CONTENT[key];
  return {
    topic: c.topic,
    seek: { prompt: c.seekPrompt },
    help: { prompt: c.helpPrompt, options: c.helpOptions },
    assess: { prompt: c.assessPrompt, considerations: c.considerations },
    reach: { prompt: c.reachPrompt },
    evaluate: { prompt: c.evaluatePrompt },
    source: 'AHRQ SHARE Approach (2014-2024); ' + c.guidelineCitation,
  };
}

// =============================================================================
// MODELS 2 & 3 — post_psa / post_mri
// =============================================================================
// Defense-in-depth: clamp/reject pathological numeric inputs reaching the
// engine from cloud-restore, JSON import, or upstream UI bugs. Form-level
// validation handles the typical-typo case; this catches the rest so the
// engine never produces a wild output from a wild input.
const sanitizePostInput = (value, { min, max, allowNull = true } = {}) => {
  if (value === '' || value === null || value === undefined) return allowNull ? null : NaN;
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  if (min != null && n < min) return NaN;
  if (max != null && n > max) return NaN;
  return n;
};

export const calculateDynamicEPsaPost = (preResult, postData, customConfig = null) => {
  const config = customConfig || DEFAULT_CALCULATOR_CONFIG;
  const { piradsLesions, knowPirads } = postData || {};
  // Range-clamp numeric inputs. PSA = 0–1000 ng/mL (anything >1000 is a typo
  // or unit-mistake; engine separately fires PSA>100 guardrail). PI-RADS is
  // strictly 1–5. Prostate volume 5–500 mL (validated range for PSAD).
  const psa = sanitizePostInput(postData?.psa, { min: 0, max: 1000 });
  const pirads = sanitizePostInput(postData?.pirads, { min: 1, max: 5 });
  const prostateVolumeValRaw = sanitizePostInput(postData?.prostateVolume, { min: 5, max: 500 });

  const preScorePct = Number(preResult?.score) || 0;
  let baseRawScore = preResult?.calculationDetails?.rawScore;
  let baseMaxScore = preResult?.calculationDetails?.maxScore;

  if (!Number.isFinite(baseRawScore)) {
    baseMaxScore = 80;
    baseRawScore = Math.round((preScorePct / 100) * baseMaxScore);
  }

  // PSA scoring
  const psaVal = psa === '' || psa === null || psa === undefined ? null : Number(psa);

  // ---------------------------------------------------------------------------
  // 5-ARI PSA Correction — AUA/SUO 2026 Guideline + REDUCE Trial
  //
  // Finasteride and dutasteride suppress PSA by ~50% after ≥6 months of use.
  // The established clinical correction is to multiply the reported PSA by 2
  // before applying any screening threshold (REDUCE trial; AUA/SUO 2026 §5-ARI).
  //
  // Limitation: The 2026 AUA/SUO guideline acknowledges individual variability —
  // only ~1/3 of patients achieve a 40–60% decline at 1 year. A ×2 correction
  // is the standard clinical default but may over- or under-correct in some
  // patients. A UI warning is surfaced to inform the user of this limitation.
  //
  // "Other" hormonal therapy: no validated correction factor exists in guidelines;
  // we flag but do not numerically adjust, consistent with AUA practice guidance.
  // ---------------------------------------------------------------------------
  const onHormonalTherapy = postData?.onHormonalTherapy === true;
  const hormonalTherapyType = postData?.hormonalTherapyType || '';
  const is5ARI = onHormonalTherapy && (hormonalTherapyType === 'finasteride' || hormonalTherapyType === 'dutasteride');
  const isOtherHormonal = onHormonalTherapy && !is5ARI;

  let psaAdjusted = psaVal;
  let psaAdjustedFlag = false;
  if (psaVal != null && !Number.isNaN(psaVal) && is5ARI) {
    psaAdjusted = psaVal * 2;
    psaAdjustedFlag = true;
  }

  let psaPoints = 0;
  if (psaAdjusted != null && !Number.isNaN(psaAdjusted)) {
    // Tier boundaries aligned with AUA_PSA_THRESHOLDS.age50_69.threshold = 3.5 ng/mL
    // per AUA/SUO 2026 age-varying PSA thresholds (50s: 3.5, 60s: 4.5, 70s: 6.5)
    if (psaAdjusted < 1.0) psaPoints = 0;
    else if (psaAdjusted < 3.5) psaPoints = 10;
    else if (psaAdjusted < 10.0) psaPoints = 25;
    else psaPoints = 45;
  }

  // PI-RADS scoring (Model 3 only)
  // Multi-lesion support: if `piradsLesions` array provided, take the highest score
  // (worst-lesion drives clinical decision-making, per AUA/EAU and ESUR PI-RADS v2.1).
  // Fallback to legacy single `pirads` field if no array supplied.
  const _piradsCandidates = Array.isArray(piradsLesions)
    ? piradsLesions
        .map(v => (v === '' || v === null || v === undefined ? null : Number(v)))
        .filter(v => v != null && !Number.isNaN(v) && v > 0)
    : [];
  const _piradsFromArray = _piradsCandidates.length > 0 ? Math.max(..._piradsCandidates) : null;
  const _piradsFromSingle = (pirads === '' || pirads === null || pirads === undefined) ? null : Number(pirads);
  const piradsVal = knowPirads
    ? (_piradsFromArray != null ? _piradsFromArray : _piradsFromSingle)
    : null;
  let piradsPoints = 0;
  let piradsOverridden = false;
  if (piradsVal != null && !Number.isNaN(piradsVal)) {
    if (piradsVal === 3) piradsPoints = 15;
    else if (piradsVal === 4) piradsPoints = 30;
    else if (piradsVal === 5) { piradsPoints = 45; piradsOverridden = true; }
  }

  const highGradeRisk = (piradsVal != null && psaAdjusted != null)
    ? calcHighGradeRisk(piradsVal, psaAdjusted)
    : null;

  // NOTE: calculateDynamicEPsa's return object does not expose top-level isBlack/fhBinary/
  // brcaStatus/familyHistory fields — only highRiskAnchors.{blackRace,familyHistory,brca}.
  // Read from there (previously read nonexistent fields, so hasHighRiskFeature below was
  // always false regardless of the patient's actual risk profile).
  const isBlack = !!preResult?.highRiskAnchors?.blackRace;
  const hasFamilyHistory = !!preResult?.highRiskAnchors?.familyHistory;
  const brcaPositive = !!preResult?.highRiskAnchors?.brca; // includes expanded germline panel (HOXB13/ATM/CHEK2/PALB2/Lynch)
  const hasHighRiskFeature =
    isBlack || hasFamilyHistory || brcaPositive || (piradsVal != null && piradsVal >= 3);

  // Low-PSA warning: PSA < 2.0 with high-risk profile
  let psaBonusLow = 0;
  let lowPsaWarning = false;
  let lowPsaWarningText = null;
  if (psaVal != null && !Number.isNaN(psaVal) && psaVal < 2.0 && hasHighRiskFeature) {
    psaBonusLow = 15;
    lowPsaWarning = true;
    lowPsaWarningText =
      'Important: Low PSA Does Not Rule Out Risk. Your PSA level is below 2.0 ng/mL, which is often considered reassuring. However, your risk profile includes one or more high-risk features (race, family history, genetic mutations, or MRI findings) that are associated with clinically significant prostate cancer even at low PSA levels. Standard guidelines do not currently account for these factors when interpreting PSA thresholds. Early evaluation with a urologist is recommended regardless of your PSA value.';
  }

  // ---------------------------------------------------------------------------
  // PSAD — PSA Density (Kadeer 2025, Front. Oncol. 15:1602134)
  // Youden-optimal cutoff: 0.177 ng/mL/cm³
  // ---------------------------------------------------------------------------
  const prostateVolumeVal =
    prostateVolumeValRaw != null && Number.isFinite(prostateVolumeValRaw) ? prostateVolumeValRaw : null;

  let psadPoints = 0;
  let psadValue = null;
  let psadFlag = false;

  if (
    prostateVolumeVal != null && !Number.isNaN(prostateVolumeVal) &&
    psaVal != null && !Number.isNaN(psaVal) &&
    prostateVolumeVal > 0
  ) {
    psadValue = psaVal / prostateVolumeVal;
    if (psadValue > 0.177) { psadPoints = 20; psadFlag = true; }
    else if (psadValue > 0.10) { psadPoints = 10; }
  }

  const totalPoints = baseRawScore + psaPoints + psaBonusLow + piradsPoints + psadPoints;

  // ---------------------------------------------------------------------------
  // Combined tier mapping
  // Boundaries: Low ≤13 | Int-Low 14-27 | Int-High 28-55 | High ≥56
  // Empirical csPCa rates: Int-High 21% (N=58), High 31% (N=32)
  // ---------------------------------------------------------------------------
  const TIER_DEFS = [
    {
      key: 'low', label: 'Low Risk', psaEquivalent: '< 1.0 ng/mL',
      guideline: 'Your combined risk profile is consistent with a PSA equivalent below 1.0 ng/mL. Per AUA, NCCN, and EAU guidelines, men in this range may follow routine screening intervals of 8-10 years if under 55, or as directed by your physician.',
      empiricalRate: COMBINED_TIER_CALIBRATION['low']
    },
    {
      key: 'intermediate-low', label: 'Intermediate-Low Risk', psaEquivalent: '1.0-2.9 ng/mL',
      guideline: 'Your combined risk profile is consistent with a PSA equivalent of 1.0-2.9 ng/mL. Guidelines recommend re-screening every 2-4 years. Discuss with your physician whether earlier follow-up is appropriate given your individual risk factors.',
      empiricalRate: COMBINED_TIER_CALIBRATION['intermediate-low']
    },
    {
      key: 'intermediate-high', label: 'Intermediate-High Risk', psaEquivalent: '3.0-9.9 ng/mL',
      guideline: 'Your combined risk profile is consistent with a PSA equivalent of 3.0-9.9 ng/mL. AUA, NCCN, and EAU guidelines recommend urology referral and shared decision-making regarding further workup including possible biopsy.',
      empiricalRate: COMBINED_TIER_CALIBRATION['intermediate-high']
    },
    {
      key: 'high', label: 'High Risk', psaEquivalent: '>= 10.0 ng/mL',
      guideline: 'Your combined risk profile warrants prompt evaluation. AUA, NCCN, and EAU guidelines strongly recommend urology referral and biopsy discussion. Do not delay follow-up with your physician.',
      empiricalRate: COMBINED_TIER_CALIBRATION['high']
    }
  ];

  let tierIndex;
  if (piradsOverridden) tierIndex = 3;
  else if (totalPoints <= 13) tierIndex = 0;
  else if (totalPoints <= 27) tierIndex = 1;
  else if (totalPoints <= 55) tierIndex = 2;
  else tierIndex = 3;

  const tierDef = TIER_DEFS[tierIndex];
  const RISK_CLASSES = ['low-risk', 'moderate-risk', 'high-risk', 'very-high-risk'];
  const riskClass = RISK_CLASSES[tierIndex];

  // PSA tier for discordance
  let psaTierIndex = null;
  let psaTierLabel = null;
  if (psaVal != null && !Number.isNaN(psaVal)) {
    // Aligned with AUA/SUO 2026 age-varying thresholds (3.5 ng/mL for 50s)
    if (psaVal < 1.0) { psaTierIndex = 0; psaTierLabel = 'Low'; }
    else if (psaVal < 3.5) { psaTierIndex = 1; psaTierLabel = 'Intermediate-Low'; }
    else if (psaVal < 10.0) { psaTierIndex = 2; psaTierLabel = 'Intermediate-High'; }
    else { psaTierIndex = 3; psaTierLabel = 'High'; }
  }

  let discordanceFlag = null;
  if (psaTierIndex != null) {
    const diff = tierIndex - psaTierIndex;
    if (diff > 0) {
      const severity = diff === 1 ? 'yellow' : 'orange';
      discordanceFlag = {
        direction: 'epsa_higher',
        severity,
        text: `Model–guideline discordance: the ePSA combined risk tier (${tierDef.label}) is higher than PSA alone (${psaVal} ng/mL, ${psaTierLabel}) would indicate. Non-PSA risk factors (race, family history, germline status) are driving the tier above the PSA-only estimate. Do not let an unremarkable PSA alone rule out further workup — corroborate with the guideline-based risk factors before deferring.`
      };
    } else if (diff < 0) {
      // PSA is higher than ePSA combined tier — clinician should not be falsely reassured by the model tier
      discordanceFlag = {
        direction: 'psa_higher',
        severity: 'yellow',
        text: `Model–guideline discordance: PSA (${psaVal} ng/mL, ${psaTierLabel}) is in a higher range than the combined ePSA tier (${tierDef.label}) alone would suggest. PSA is an independent, guideline-recognized signal — evaluate and manage the PSA value on its own merits regardless of the lower combined tier.`
      };
    }
  }

  // ---------------------------------------------------------------------------
  // PI-RADS confidence text (Model 3) — guideline-based
  // ---------------------------------------------------------------------------
  let piradsConfidenceText = null;
  if (piradsVal != null) {
    const piradsMessages = {
      1: 'PI-RADS 1: Very low. Clinically significant cancer is highly unlikely to be present. (PI-RADS v2.1)',
      2: 'PI-RADS 2: Low. Clinically significant cancer is unlikely to be present. (PI-RADS v2.1)',
      3: 'PI-RADS 3: Intermediate. The presence of clinically significant cancer is equivocal. Shared decision-making with your urologist is recommended. (PI-RADS v2.1)',
      4: 'PI-RADS 4: High. Clinically significant cancer is likely to be present. AUA/NCCN/EAU guidelines recommend biopsy discussion. (PI-RADS v2.1)',
      5: 'PI-RADS 5: Very high. Clinically significant cancer is highly likely to be present. AUA/NCCN/EAU guidelines recommend biopsy without delay. (PI-RADS v2.1)'
    };
    piradsConfidenceText = piradsMessages[piradsVal] || null;
  }

  // ---------------------------------------------------------------------------
  // Empirical probability display (Models 2 & 3)
  // Return data only — UI renders via i18n
  // (`part2Results.empiricalProbabilityText`). For the `low` combined tier,
  // rate is null (no cases in the biopsied referral cohort) and the UI hides
  // the line entirely — this is correct behavior, not a tier mismatch.
  // ---------------------------------------------------------------------------
  const cal = tierDef.empiricalRate;
  const empiricalProbabilityText = null; // deprecated — UI builds via i18n
  const empiricalNote = cal?.note ?? null;

  // ---------------------------------------------------------------------------
  // Biopsy / urology referral recommendation
  //
  // AUA/SUO 2026 Guideline: urology referral and biopsy discussion are
  // recommended for patients with elevated combined risk profiles regardless
  // of whether MRI was performed. An elevated PSA in the context of a high
  // ePSA risk score warrants the same shared decision-making conversation.
  //
  // PI-RADS 5 override: AUA/NCCN/EAU uniformly recommend biopsy discussion
  // for PI-RADS 5 findings without delay.
  //
  // High discordance: when ePSA profile significantly exceeds what PSA alone
  // suggests, referral is warranted regardless of MRI status.
  // ---------------------------------------------------------------------------
  let biopsyRecommended = false;
  let biopsyReason = null;
  let biopsyMessage = null;

  if (piradsOverridden) {
    biopsyRecommended = true;
    biopsyReason = 'pirads_5';
    biopsyMessage = 'Your MRI identified a PI-RADS 5 finding. AUA, NCCN, and EAU guidelines recommend prompt biopsy discussion with a urologist. Do not delay this conversation.';
  } else if (piradsVal === 4) {
    biopsyRecommended = true;
    biopsyReason = 'pirads_4';
    biopsyMessage = 'Your MRI identified a PI-RADS 4 finding ("likely to be present"). AUA/NCCN/EAU guidelines recommend a biopsy discussion with a urologist for PI-RADS 4 findings.';
  } else if (totalPoints >= 56) {
    biopsyRecommended = true;
    biopsyReason = 'combined_score_high';
    biopsyMessage = 'Your combined risk profile is high. AUA/NCCN/EAU 2026 guidelines recommend discussing biopsy with a urologist. Do not delay this conversation.';
  } else if (discordanceFlag && discordanceFlag.severity === 'orange' && tierIndex >= 2) {
    biopsyRecommended = true;
    biopsyReason = 'high_risk_discordance';
    biopsyMessage = 'Your ePSA risk profile is significantly higher than your PSA level alone suggests. Combined with your other risk factors, urologist review and biopsy discussion are recommended per AUA/SUO 2026 guidelines.';
  }

  // ---------------------------------------------------------------------------
  // Guideline support matrix — which guidelines back each biopsy reason.
  // ERSPC focuses on screening intervals, not biopsy triggers, so it is
  // conservatively marked false for biopsy-decision rows.
  // ---------------------------------------------------------------------------
  const BIOPSY_GUIDELINE_SUPPORT = {
    pirads_5:                { aua: true,  nccn: true,  eau: true,  erspc: false },
    pirads_4:                { aua: true,  nccn: true,  eau: true,  erspc: false },
    combined_score_high:     { aua: true,  nccn: true,  eau: true,  erspc: false },
    high_risk_discordance:   { aua: true,  nccn: false, eau: false, erspc: false }
  };
  // Combined-tier guideline backing for the tier recommendation itself.
  const COMBINED_TIER_GUIDELINE_SUPPORT = {
    'low':               { aua: true, nccn: true, eau: true, erspc: true  },
    'intermediate-low':  { aua: true, nccn: true, eau: true, erspc: true  },
    'intermediate-high': { aua: true, nccn: true, eau: true, erspc: false },
    'high':              { aua: true, nccn: true, eau: true, erspc: false }
  };
  const biopsyGuidelineSupport = biopsyReason
    ? (BIOPSY_GUIDELINE_SUPPORT[biopsyReason] || null)
    : null;
  const biopsyGuidelineSupportCount = biopsyGuidelineSupport
    ? Object.values(biopsyGuidelineSupport).filter(Boolean).length
    : null;
  const tierGuidelineSupport = COMBINED_TIER_GUIDELINE_SUPPORT[tierDef.key] || null;
  const tierGuidelineSupportCount = tierGuidelineSupport
    ? Object.values(tierGuidelineSupport).filter(Boolean).length
    : null;

  const pathwayMode = postData?.pathwayMode || (knowPirads ? 'post_mri' : 'post_psa');

  // ---------------------------------------------------------------------------
  // MRI recommendation — for post_psa pathway (no MRI data entered yet)
  // AUA 2026 Statement 13 (Conditional, Grade A): Clinicians may use MRI prior to
  // initial biopsy to increase detection of GG2+ prostate cancer. (AUA 2026 EDPC p.19)
  // PSA threshold: 4.0 ng/mL — "the commonly cited threshold" (AUA 2026 EDPC p.11).
  // Statement 13 does not specify a PSA cutoff; 4.0 is the historically established
  // threshold for "elevated PSA warranting further workup" per the same document.
  // ---------------------------------------------------------------------------
  let mriRecommended = false;
  let mriRecommendReason = null;
  let mriRecommendMessage = null;

  if (!knowPirads) {
    if (psaVal >= 4.0) {
      mriRecommended = true;
      mriRecommendReason = 'psa_elevated';
      mriRecommendMessage = 'Your PSA (≥ 4.0 ng/mL) warrants further evaluation. AUA/NCCN/EAU guidelines recommend an mpMRI before biopsy to characterize any suspicious lesion and reduce unnecessary biopsies. (AUA 2026 Statement 13 — Conditional, Grade A)';
    } else if (tierIndex >= 2) {
      mriRecommended = true;
      mriRecommendReason = 'combined_risk_elevated';
      mriRecommendMessage = 'Your combined ePSA + PSA profile places you in an elevated risk tier. An mpMRI is recommended to better characterize risk before any biopsy decision, per AUA/NCCN/EAU guidelines.';
    } else if (hasHighRiskFeature && psaVal >= 2.5) {
      mriRecommended = true;
      mriRecommendReason = 'high_risk_profile';
      mriRecommendMessage = 'Given your high-risk profile (Black ancestry, family history, or genetic mutation), an mpMRI is recommended even at this PSA level per AUA/NCCN guidelines.';
    } else if (discordanceFlag && discordanceFlag.severity === 'orange') {
      mriRecommended = true;
      mriRecommendReason = 'discordance';
      mriRecommendMessage = 'Your ePSA profile is significantly higher than your PSA alone suggests. An mpMRI can help characterize your risk and is recommended per AUA/NCCN guidelines before biopsy.';
    }
  }

  // ---------------------------------------------------------------------------
  // Re-screening interval — driven by prior/baseline PSA, not just current PSA.
  // AUA/SUO 2026 EDPC p.14-15 (validated against guideline PDFs 2026-07-14):
  //   - Baseline PSA 1-3 ng/mL: re-screen every 1-4 years.
  //   - Baseline PSA <1 ng/mL, or below age-specific median: re-screening interval
  //     may be substantially prolonged.
  //   - Age >=75 with PSA <3 ng/mL: clinicians may discontinue or substantially
  //     lengthen the re-screening interval.
  // `priorPsa` is the patient's prior/baseline PSA value (distinct from the
  // current-visit `psa`), entered on the post-PSA/MRI intake form. Additive —
  // absent priorPsa produces no interval recommendation (null), no change to
  // any existing scoring or recommendation logic.
  // ---------------------------------------------------------------------------
  const priorPsaVal = sanitizePostInput(postData?.priorPsa, { min: 0, max: 1000 });
  const priorPsaNum = priorPsaVal === '' || priorPsaVal === null || priorPsaVal === undefined ? null : Number(priorPsaVal);
  const ageForInterval = Number(preResult?.age);
  let rescreeningIntervalYears = null;
  let rescreeningIntervalReason = null;
  let rescreeningIntervalMessage = null;
  if (priorPsaNum != null && !Number.isNaN(priorPsaNum)) {
    if (Number.isFinite(ageForInterval) && ageForInterval >= 75 && priorPsaNum < 3) {
      rescreeningIntervalYears = 'discontinue_or_lengthen';
      rescreeningIntervalReason = 'age75_low_baseline_psa';
      rescreeningIntervalMessage = `At age ${ageForInterval} with a prior PSA of ${priorPsaNum} ng/mL (<3), clinicians may discontinue screening or substantially lengthen the re-screening interval, per AUA/SUO 2026 EDPC p.15. This is a starting point for discussion with your physician, not a standalone decision.`;
    } else if (priorPsaNum < 1) {
      rescreeningIntervalYears = 'prolonged';
      rescreeningIntervalReason = 'low_baseline_psa';
      rescreeningIntervalMessage = `A prior PSA below 1 ng/mL is associated with a substantially prolonged re-screening interval per AUA/SUO 2026 EDPC p.14.`;
    } else if (priorPsaNum >= 1 && priorPsaNum <= 3) {
      rescreeningIntervalYears = '1-4';
      rescreeningIntervalReason = 'moderate_baseline_psa';
      rescreeningIntervalMessage = `A prior PSA of ${priorPsaNum} ng/mL (1-3 ng/mL range) supports a re-screening interval of 1 to 4 years per AUA/SUO 2026 EDPC p.14.`;
    } else {
      rescreeningIntervalYears = 'standard';
      rescreeningIntervalReason = 'elevated_baseline_psa';
      rescreeningIntervalMessage = `A prior PSA above 3 ng/mL does not support interval-lengthening; follow standard age-based re-screening guidance and discuss with your physician.`;
    }
  }

  const guardrailAlerts = checkGuardrails({
    psa: psaAdjusted,
    pirads: piradsVal,
    psad: psadValue,
    ggg: postData?.ggg,
    age: preResult?.age,
    highRiskFeatures: hasHighRiskFeature,
    hasTwoComorbidities: Boolean(preResult?.highRiskAnchors?.twoComorbidities),
  }, pathwayMode);

  // ---------------------------------------------------------------------------
  // Part 2 output-statement tiers (product spec, 5 tiers) — normal_routine_interval /
  // borderline_repeat_advised / gray_zone_confounder_reassess / elevated_imaging_advised /
  // markedly_elevated_prompt_referral.
  //
  // Age-adjusted threshold: reuses AUA_PSA_THRESHOLDS (already defined and cited
  // above — AUA/SUO 2026 EDPC p.11, Statements 4/6/7: 2.5 ng/mL ages 45-49,
  // 3.5 ages 50-59, 4.5 ages 60-69, 6.5 ages 70+). Below age 45 (no defined AUA
  // band), falls back to the 4.0 ng/mL "commonly cited" universal PSA threshold
  // already used elsewhere in this function for mriRecommendReason='psa_elevated'
  // (AUA 2026 EDPC p.11).
  //
  // Gray-zone upper bound (10.0 ng/mL): the classic PSA "diagnostic gray zone"
  // (~4-10 ng/mL) established by Catalona WJ et al. "Use of the percentage of
  // free prostate-specific antigen to enhance differentiation of prostate
  // cancer from benign prostatic disease." JAMA. 1998;279(19):1542-1547 — the
  // widely-cited origin of the free/total-PSA gray-zone literature. This value
  // also already matches this engine's own psaTierIndex boundary (>=10.0 ng/mL
  // = "High" tier, see psaTierIndex above), so no new inconsistent number is
  // introduced.
  //
  // Borderline vs. clearly-elevated split within the gray zone reuses the AUA
  // guideline's OWN stated action for exceeding threshold at each age band
  // (AUA_PSA_THRESHOLDS[band].action_above, already defined/cited above):
  // ages 45-49 exceeding 2.5 ng/mL maps to 'biannual' (repeat later) per
  // AUA/SUO 2026 Statement 4, which is exactly the spec's "repeat to confirm
  // before escalation" framing for the borderline tier. Ages 50+ exceeding
  // their threshold map to 'urology_referral' per Statement 6/7 — i.e.
  // guideline already treats that as clearly elevated, matching the spec's
  // "no confounder -> imaging advised" tier rather than "just repeat."
  //
  // Confounders (new optional boolean fields, below). The product spec's
  // Step 2 "Gray zone with confounder" tier names four factors: urinary
  // symptoms/infection, recent cycling, DRE before the draw, and recent
  // ejaculation. AUDIT CORRECTION (medical-grounding review): the individual
  // primary-literature citations originally attached to each of these were
  // checked against the CURRENT AUA/SUO 2026 guideline itself (the same
  // guideline every other threshold in this file is anchored to) — and the
  // guideline's own text contradicts two of the four:
  //
  //   "Neither DRE nor bicycle riding appreciably alters the PSA... and most
  //   controlled studies evaluating ejaculation suggest it either does not
  //   significantly impact or modestly increases (~10%) PSA. Clinicians
  //   should also recognize that urinary tract infections and
  //   instrumentation... cause transient increases in PSA."
  //   — AUA/SUO 2026 EDPC, supporting text under Statement 3 (p.11)
  //
  // So per the guideline the app is otherwise built on: urinary/infective
  // symptoms are a real, confirmed confounder; ejaculation has a real but
  // modest (~10%) effect (consistent with the spec's ~3-day washout framing,
  // kept as a secondary trigger); DRE and cycling do NOT appreciably move
  // PSA and should not, by themselves, be sufficient to defer an imaging-
  // track workup. (The DRE citation previously attached here — Yuan et al.,
  // J Urol 1992 — actually reported "no clinically significant difference in
  // PSA levels" from DRE; the cycling citation — Mejak et al., PLoS One
  // 2013;8:e56030 — found a real effect in one cohort, but the field's
  // evidence is mixed (a separate controlled study found no important
  // impact, and a systematic review/meta-analysis exists on this exact
  // question), and the current guideline's own synthesis lands on "no
  // appreciable effect.") Both citations were themselves being misapplied,
  // not just imprecisely formatted.
  //
  // Rather than silently dropping DRE/cycling (the product spec explicitly
  // named all four, plausibly for a "when in doubt, recheck" patient-safety
  // margin that intentionally goes beyond the guideline's own evidence bar —
  // a legitimate product choice, not a medical error, IF it was made
  // deliberately) they are downgraded to INFORMATIONAL-only here: still
  // captured and surfaced to the clinician (part2Tier.confounders below
  // includes all four), but no longer sufficient alone to select the
  // gray-zone-confounder tier. Flagged for explicit product/clinical
  // sign-off on whether this downgrade (or full removal) is correct.
  const recentVigorousCycling = postData?.recentVigorousCycling === true;
  const drePerformedBeforeDraw = postData?.drePerformedBeforeDraw === true;
  // Tier-changing confounders: urinary/infective symptoms (confirmed),
  // recent ejaculation (real but modest ~10% effect, per guideline text
  // above), and recent instrumentation — see AUDIT CORRECTION comment.
  // Ejaculation citation (Tchetgen et al., Urology 1996;47:511-516) checked
  // and accurate as originally cited.
  const recentEjaculation = postData?.recentEjaculation === true;
  const urinarySymptomsInfection = postData?.urinarySymptomsInfection === true;
  // Recent instrumentation (bladder catheterization, prostate biopsy, or
  // cystoscopy) — the SAME AUA/SUO 2026 guideline text quoted above ("...
  // urinary tract infections and instrumentation (e.g., recent bladder
  // catheterization, prostate biopsy or cystoscopy, urinary retention)...
  // cause transient increases in PSA") names this as a confirmed confounder
  // in the same breath as UTI, but it was never wired as an input field —
  // a PSA drawn shortly after a biopsy (a routine, expected scenario) fell
  // through to elevated_imaging_advised with no way to flag the cause.
  const recentInstrumentation = postData?.recentInstrumentation === true;
  const hasConfounder = recentEjaculation || urinarySymptomsInfection || recentInstrumentation;
  // Informational-only: shown to the clinician via part2Tier.confounders, but
  // per the guideline text above, not treated as evidence that PSA elevation
  // has a benign explanation.
  const hasInformationalOnlyConfounder = recentVigorousCycling || drePerformedBeforeDraw;

  const AUA_AGE_BAND_ORDER = ['age45_49', 'age50_59', 'age60_69', 'age70plus'];
  const getAuaAgeBandKey = (a) => {
    if (!Number.isFinite(a) || a < 45) return null;
    if (a <= 49) return 'age45_49';
    if (a <= 59) return 'age50_59';
    if (a <= 69) return 'age60_69';
    return 'age70plus';
  };
  const ageForPart2Tier = Number(preResult?.age);
  const auaAgeBandKey = getAuaAgeBandKey(ageForPart2Tier);
  const auaAgeBandInfo = auaAgeBandKey ? AUA_PSA_THRESHOLDS[auaAgeBandKey] : null;
  const UNIVERSAL_PSA_FALLBACK_THRESHOLD = 4.0; // AUA 2026 EDPC p.11 "commonly cited" threshold — same value already used for mriRecommendReason='psa_elevated' above
  const ageAdjustedThreshold = auaAgeBandInfo?.threshold ?? UNIVERSAL_PSA_FALLBACK_THRESHOLD;
  const GRAY_ZONE_UPPER = 10.0; // Catalona et al. JAMA. 1998;279(19):1542-1547 — classic PSA gray-zone upper bound; matches existing psaTierIndex 'High' boundary

  const stronglyDiscordantExtendedRisk =
    !!(discordanceFlag && discordanceFlag.direction === 'epsa_higher' && discordanceFlag.severity === 'orange' && hasHighRiskFeature);

  // Unified "strong risk factor (guideline or extended)" signal for the Borderline
  // and Gray-zone-confounder tiers below. The product spec requires BOTH tiers to
  // check "no strong risk factor (guideline or extended)" — but this function
  // previously only read `hasHighRiskFeature` (Black ancestry / family history /
  // confirmed BRCA / PI-RADS>=3 — a Part-2-local, guideline-oriented flag defined
  // above) and never consulted Part 1's own extended-risk classification
  // (`part1Tier.extendedRiskStrength`, computed in calculateDynamicEPsa from
  // hereditary-cancer family history + Ashkenazi ancestry + expanded germline
  // panel + prior biopsy history — see PART1_TIER_DEFS/EXTENDED_RISK_STRONG_THRESHOLD
  // above). A patient who is "strong" by Part 1's extended-risk definition but not
  // flagged by hasHighRiskFeature (e.g. hereditary-cancer FH + Ashkenazi ancestry,
  // with no direct prostate family history or confirmed BRCA) was previously still
  // eligible for Borderline/Gray-zone-confounder despite the spec's "or extended"
  // clause. preResult is calculateDynamicEPsa's full return value, so part1Tier is
  // always available here — no new parameter needed.
  const part1ExtendedRiskStrong = preResult?.part1Tier?.extendedRiskStrength === 'strong';
  const hasStrongRiskFactor = hasHighRiskFeature || part1ExtendedRiskStrong;

  // ---------------------------------------------------------------------------
  // Urology red flags — highest-priority override, checked ahead of every
  // PSA-based tier. AUA/SUO 2026 EDPC and standard urology practice route
  // gross hematuria, acute urinary retention, or a hard/irregular prostate on
  // DRE straight to urology regardless of the PSA value or its tier — these
  // are exam/symptom findings, not PSA-derived risk. Previously there was no
  // input field for any of this, so a red-flag patient (e.g. a hard, irregular
  // prostate reported by the referring physician) was scored purely on PSA
  // and could land on a routine "Elevated — Imaging Advised" tier instead of
  // urgent referral.
  // ---------------------------------------------------------------------------
  const urologyRedFlagHematuria = postData?.urologyRedFlagHematuria === true;
  const urologyRedFlagRetention = postData?.urologyRedFlagRetention === true;
  const urologyRedFlagAbnormalDre = postData?.urologyRedFlagAbnormalDre === true;
  const hasUrologyRedFlag = urologyRedFlagHematuria || urologyRedFlagRetention || urologyRedFlagAbnormalDre;

  // ---------------------------------------------------------------------------
  // PSA confirmation — AUA/SUO 2026 EDPC, Expert Opinion under Statement 3:
  // clinicians should repeat a newly elevated PSA before ordering a secondary
  // biomarker, imaging, or biopsy, since PSA normalizes in many cases.
  // Defaults to `true` (confirmed) so existing callers that don't pass this
  // field see no behavior change — the recheck path only activates when a
  // caller explicitly marks the PSA as `psaConfirmed: false`. Only applies to
  // the borderline/gray-zone/elevated band; a markedly elevated or discordant
  // PSA still routes straight to referral even if unconfirmed — the safety
  // margin runs the other way at that level (see PSA_VERY_HIGH guardrail,
  // which likewise does not wait on confirmation above 100 ng/mL).
  // ---------------------------------------------------------------------------
  const psaConfirmed = postData?.psaConfirmed !== false;

  let part2TierKey = null;
  if (hasUrologyRedFlag) {
    part2TierKey = 'urology_red_flag_referral';
  } else if (psaAdjusted != null && !Number.isNaN(psaAdjusted)) {
    // Discordance/very-high-PSA override checked FIRST: per spec, "combined risk
    // discordant with PSA alone due to extended risk factors" applies specifically
    // to the case where PSA in isolation looks unremarkable but the combined
    // profile is not — an unremarkable PSA must not be allowed to mask that.
    if (psaAdjusted >= GRAY_ZONE_UPPER || stronglyDiscordantExtendedRisk) {
      part2TierKey = 'markedly_elevated_prompt_referral';
    } else if (psaAdjusted < ageAdjustedThreshold) {
      part2TierKey = 'normal_routine_interval';
    } else if (!psaConfirmed) {
      part2TierKey = 'unconfirmed_repeat_advised';
    } else if (hasConfounder && !hasStrongRiskFactor) {
      part2TierKey = 'gray_zone_confounder_reassess';
    } else if (!hasConfounder && !hasStrongRiskFactor && auaAgeBandInfo?.action_above === 'biannual') {
      // Borderline requires ALL THREE per spec: no confounder, no strong risk
      // factor (guideline or extended), and the AUA band's own action being
      // "repeat later" rather than "refer." A strong-risk patient with no
      // confounder falls through to Elevated below instead of Borderline —
      // their risk profile means a marginal PSA still warrants imaging-track
      // follow-up rather than a plain repeat-and-wait.
      part2TierKey = 'borderline_repeat_advised';
    } else {
      part2TierKey = 'elevated_imaging_advised';
    }
  }

  const PART2_TIER_DEFS = {
    normal_routine_interval: {
      label: 'Normal — Routine Interval',
      description: 'PSA below the age-adjusted threshold. No action beyond routine surveillance; repeat per the age-based interval (e.g. every 2-4 years).',
    },
    unconfirmed_repeat_advised: {
      label: 'Unconfirmed — Repeat PSA',
      description: 'PSA at or above the age-adjusted threshold but not yet confirmed on a repeat test. Per AUA/SUO 2026 guidance, repeat the PSA before ordering imaging, a secondary biomarker, or biopsy — PSA normalizes in many cases.',
    },
    borderline_repeat_advised: {
      label: 'Borderline — Repeat Advised',
      description: 'PSA marginally above threshold; no confounder and no strong risk factor (guideline or extended). Repeat PSA to confirm before escalation.',
    },
    urology_red_flag_referral: {
      label: 'Urology Red Flag — Refer Now',
      description: 'Gross hematuria, acute urinary retention, or a hard/irregular prostate on DRE is present. Refer to urology now regardless of PSA value or tier — these are exam/symptom findings that warrant direct evaluation.',
    },
    gray_zone_confounder_reassess: {
      // Description text intentionally unchanged from the product spec's exact
      // four-factor wording pending clinical sign-off (see AUDIT CORRECTION
      // comment above `hasConfounder`) — only the TRIGGER LOGIC was narrowed
      // to urinary/infective symptoms and ejaculation. Recent cycling and DRE
      // are still surfaced (part2Tier.confounders.recentVigorousCycling /
      // .drePerformedBeforeDraw) but no longer alone sufficient to select
      // this tier, per the current AUA/SUO 2026 guideline's own text.
      label: 'Gray Zone With Confounder — Reassess',
      description: 'PSA in the gray zone (~3-10) with a potential confounder: urinary/infective symptoms, recent instrumentation (catheterization, prostate biopsy, or cystoscopy), recent cycling, DRE before the draw, or ejaculation within ~3 days. Allow washout of the confounder and repeat; refer for urologist reassessment if it persists. Do not trigger imaging on this single value.',
    },
    elevated_imaging_advised: {
      label: 'Elevated — Imaging Advised',
      description: 'PSA clearly above threshold within the gray zone, no confounder. Recommend multiparametric prostate MRI (PI-RADS) to stratify risk before any biopsy decision.',
    },
    markedly_elevated_prompt_referral: {
      label: 'Markedly Elevated — Prompt Referral',
      description: 'PSA markedly elevated (above the gray-zone upper bound), or combined risk discordant with PSA alone owing to extended risk factors (ancestry, family history, germline status). Expedite urology referral and prostate MRI; examine and exclude urinary retention/infection.',
    },
  };
  const part2Tier = part2TierKey
    ? {
        key: part2TierKey,
        label: PART2_TIER_DEFS[part2TierKey].label,
        description: PART2_TIER_DEFS[part2TierKey].description,
        ageAdjustedThreshold,
        grayZoneUpper: GRAY_ZONE_UPPER,
        // recentVigorousCycling/drePerformedBeforeDraw are informational-only
        // (see AUDIT CORRECTION comment above) — included here for clinician
        // visibility but excluded from `any`/`hasConfounder`, which drives
        // tier selection and only reflects urinarySymptomsInfection/
        // recentEjaculation.
        confounders: {
          recentVigorousCycling, drePerformedBeforeDraw, recentEjaculation, urinarySymptomsInfection,
          recentInstrumentation,
          any: hasConfounder,
          informationalOnly: hasInformationalOnlyConfounder,
        },
        // Unified guideline-or-extended "strong risk factor" signal used to gate
        // Borderline/Gray-zone-confounder above — surfaced for callers/tests/UI
        // that need to explain WHY a tier was (or wasn't) selected.
        strongRiskFactor: { guideline: hasHighRiskFeature, extended: part1ExtendedRiskStrong, any: hasStrongRiskFactor },
        psaConfirmed,
        urologyRedFlag: {
          hematuria: urologyRedFlagHematuria,
          retention: urologyRedFlagRetention,
          abnormalDre: urologyRedFlagAbnormalDre,
          any: hasUrologyRedFlag,
        },
      }
    : null;

  return {
    priorPsa: priorPsaNum,
    rescreeningIntervalYears,
    rescreeningIntervalReason,
    rescreeningIntervalMessage,
    // Provenance — used by the results meta-bar for audit/citation
    computedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    // Core combined score
    riskPct: tierDef.psaEquivalent,
    riskPctRange: null,
    riskCat: tierDef.label,
    riskClass,
    totalPoints,
    prePoints: baseRawScore,
    baselineCarryPoints: null,
    psaPoints,
    piradsPoints,
    psadPoints,

    // Tier
    epsaTierIndex: tierIndex,
    epsaTierKey: tierDef.key,
    guidelineText: tierDef.guideline,
    nextSteps: [tierDef.guideline],
    // Part 2 output-statement tier (product spec, 5 tiers) — see PART2_TIER_DEFS above
    part2Tier,

    // Flags
    piradsOverridden,
    discordanceFlag,
    lowPsaWarning,
    lowPsaWarningText,
    psadValue,
    psadFlag,

    // PSA context
    psaTier: psaTierLabel,
    psaValue: psaVal,
    psaAdjusted,
    psaAdjustedFlag,
    isOtherHormonal,

    // High-grade risk (Model 3 logistic regression)
    highGradeRisk,

    // MRI recommendation (post_psa pathway)
    mriRecommended,
    mriRecommendReason,
    mriRecommendMessage,

    // Biopsy (Model 3)
    biopsyRecommended,
    biopsyReason,
    biopsyMessage,
    biopsyGuidelineSupport,
    biopsyGuidelineSupportCount,
    tierGuidelineSupport,
    tierGuidelineSupportCount,
    sdmGuide: buildShareModelGuide({ psaRecommendReason: null, recommendPSA: null, mriRecommendReason, biopsyReason }),

    // Confidence
    piradsConfidenceText,
    empiricalProbabilityText,
    empiricalRate: cal?.rate ?? null,
    empiricalRateN: cal?.n ?? null,
    empiricalRateEvents: cal?.events ?? null,
    empiricalNote,

    // Guardrails
    guardrailAlerts,

    // Metadata
    pathwayMode,
    modelVersion: config.version
  };
};

// =============================================================================
// MODEL 4 — calculateActiveSurveillance — MOVED TO AS TOOL
// This function has been extracted to the standalone AI Surveillance Tool repo.
// See: as.millionstrongmen.com
// =============================================================================
// Kept as a stub so any lingering references surface clearly at runtime.
export const calculateActiveSurveillance = () => {
  console.error('calculateActiveSurveillance has moved to the standalone AI Surveillance Tool repo.');
  return null;
};
