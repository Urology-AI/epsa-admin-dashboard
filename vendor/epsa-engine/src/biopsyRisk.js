/**
 * biopsyRisk.js — GG≥2 prostate-biopsy risk model (ePSA Model v4).
 *
 * Ported from Urology-AI/biopsy-prediction, model/model.py — that repo remains
 * the source of truth for training/refitting (model/train_v3.py,
 * training/refit_part2_cancer_model.py) and validation methodology. This file
 * is a direct line-for-line port of the frozen v4 coefficients so JS/TS
 * consumers (e-psa/backend, and anything else on this engine) get the same
 * model without hand-transcribing coefficients themselves. When
 * biopsy-prediction retrains and freezes a new version, port the change here
 * — do not let a second hand-copy exist elsewhere.
 *
 * v4: N=126, Mount Sinai biopsy registry, 39.7% GG≥2 prevalence, AUC OOF
 * 0.7389, retrained 2026-07-02. Predictors: logPSA + logVolume + PI-RADS
 * dummies (ref: PI-RADS 1-2). Falls back to v3 (logPSA + PSAD + PI-RADS)
 * when volume is unavailable but PSAD is, or v2 (logPSA + PI-RADS only)
 * when neither is available.
 */

// AUA 2026 Table 5 population-level GG≥2 detection rates by PI-RADS
// (pooled 23 studies; AUA/SUO EDPC 2026 p.21)
export const BIOPSY_GUIDELINE_RATES = {
  1: '7% (95%CI 4–11%)',
  2: '7% (95%CI 4–11%)',
  3: '11% (95%CI 8–14%)',
  4: '37% (95%CI 33–40%)',
  5: '70% (95%CI 62–79%)',
};

export const BIOPSY_RELIABLE_PIRADS = new Set([4, 5]);

// Literature-anchored threshold — see Urology-AI/biopsy-prediction model/model.py
// module docstring for the full derivation against AUA/SUO 2026 EDPC Statement 11 / Part II.
export const BIOPSY_MODEL_VERSION = 'v4';
export const BIOPSY_THRESHOLD = 0.25;

/**
 * predictBiopsyRisk — P(GG>=2) given PI-RADS, PSA, and (optionally) prostate
 * volume or PSAD.
 *
 * @param {number} pirads - 1-5
 * @param {number} psa - ng/mL, must be > 0
 * @param {number|null} [prostateVolumeCc] - preferred predictor when available
 * @param {number|null} [psad] - used only when prostateVolumeCc is unavailable
 * @returns {null | {
 *   prob: number, percent: number, interpretation: string,
 *   guidelineRate: string, reliable: boolean,
 *   psad: number|null, psadTier: string|null, modelVersion: string,
 * }}
 */
export function predictBiopsyRisk(pirads, psa, prostateVolumeCc = null, psad = null) {
  if (pirads === null || pirads === undefined || psa === null || psa === undefined) return null;
  if (![1, 2, 3, 4, 5].includes(pirads)) return null;
  if (!(psa > 0)) return null;
  if (prostateVolumeCc !== null && prostateVolumeCc !== undefined && !(prostateVolumeCc > 0)) return null;

  const pirads3 = pirads === 3 ? 1 : 0;
  const pirads4 = pirads === 4 ? 1 : 0;
  const pirads5 = pirads === 5 ? 1 : 0;
  const logPsa = Math.log(Math.max(psa, 0.01));

  const hasVolume = prostateVolumeCc !== null && prostateVolumeCc !== undefined;
  const hasPsad = psad !== null && psad !== undefined;

  let logit;
  let modelVersion;

  if (hasVolume) {
    // v4 — logPSA + logVolume + PI-RADS
    const logVol = Math.log(Math.max(prostateVolumeCc, 1.0));
    logit =
      0.928327 +
      0.234065 * logPsa +
      -0.693935 * logVol +
      -0.274166 * pirads3 +
      0.953916 * pirads4 +
      1.898259 * pirads5;
    modelVersion = 'v4 (PSA + volume + PI-RADS)';
  } else if (hasPsad) {
    // v3 fallback — logPSA + PSAD + PI-RADS (volume unavailable)
    logit =
      -1.485772 +
      0.145017 * logPsa +
      0.942349 * psad +
      -1.181514 * pirads3 +
      0.468079 * pirads4 +
      0.735267 * pirads5;
    modelVersion = 'v3 fallback (PSA + PSAD + PI-RADS)';
  } else {
    // v2 fallback when neither volume nor PSAD is available
    logit =
      -1.526236 +
      0.260607 * logPsa +
      -1.200596 * pirads3 +
      0.424159 * pirads4 +
      0.792264 * pirads5;
    modelVersion = 'v2 fallback (PSA + PI-RADS)';
  }

  const prob = 1 / (1 + Math.exp(-logit));
  const percent = Math.round(prob * 1000) / 10;

  // Bands calibrated to 39.7% GG≥2 prevalence, anchored to BIOPSY_THRESHOLD (0.25)
  let interpretation;
  if (prob < 0.15) {
    interpretation = 'Low GG≥2 risk';
  } else if (prob < BIOPSY_THRESHOLD) {
    interpretation = 'Below-average GG≥2 risk';
  } else if (prob < 0.45) {
    interpretation = 'Intermediate GG≥2 risk — biopsy recommended';
  } else {
    interpretation = 'Elevated GG≥2 risk — biopsy strongly recommended';
  }

  // ---------------------------------------------------------------------------
  // Part 3 output-statement tier (product spec, 4 tiers) — biopsy_not_indicated /
  // monitoring_advised / biopsy_discussion_advised / biopsy_recommended.
  //
  // Maps 1:1 onto the probability bands already established above (unchanged
  // cutoffs — 0.15, BIOPSY_THRESHOLD=0.25, 0.45). BIOPSY_THRESHOLD itself is
  // literature-anchored per this file's module docstring and the
  // biopsy-prediction repo's model/model.py derivation against AUA/SUO 2026
  // EDPC Statement 11 / Part II; 0.15 and 0.45 are the same pre-existing band
  // edges used for `interpretation` above (Low / Below-average / Intermediate /
  // Elevated, calibrated to the 39.7% GG≥2 prevalence of the N=126 training
  // cohort) — no new cutoffs are introduced, only new tier names layered on
  // the existing bands.
  // ---------------------------------------------------------------------------
  let tierKey;
  let tierLabel;
  if (prob < 0.15) {
    tierKey = 'biopsy_not_indicated';
    tierLabel = 'Biopsy Not Indicated';
  } else if (prob < BIOPSY_THRESHOLD) {
    tierKey = 'monitoring_advised';
    tierLabel = 'Monitoring Advised';
  } else if (prob < 0.45) {
    tierKey = 'biopsy_discussion_advised';
    tierLabel = 'Biopsy Discussion Advised';
  } else {
    tierKey = 'biopsy_recommended';
    tierLabel = 'Biopsy Recommended';
  }
  const tier = { key: tierKey, label: tierLabel };

  // PSAD tier (AUA 2026 Statement 16) — informational only, not used in logit
  let psadTier = null;
  if (hasPsad) {
    if (psad < 0.1) {
      psadTier = 'Low (<0.10) — biopsy may be deferred (NPV 94%)';
    } else if (psad < 0.15) {
      psadTier = 'Borderline (0.10–0.15)';
    } else {
      psadTier = 'Elevated (≥0.15) — supports biopsy';
    }
  }

  return {
    prob,
    percent,
    interpretation,
    tier,
    guidelineRate: BIOPSY_GUIDELINE_RATES[pirads] ?? '—',
    reliable: BIOPSY_RELIABLE_PIRADS.has(pirads),
    psad: hasPsad ? Math.round(psad * 1000) / 1000 : null,
    psadTier,
    modelVersion,
  };
}
