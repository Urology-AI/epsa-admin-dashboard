// ePSA MODEL 2 test sequence — physician ground-truth validation set.
// Pathway: post_psa — "I have a PSA result" (calculateDynamicEPsaPost()).
// Source: "ePSA_test_sequence_model2.xlsx" (Test Cases sheet).
//
// Each case has TWO input payloads, matching the engine's two-step call:
//   preFormData  — minimal Model 1 fields, fed to calculateDynamicEPsa() to
//                  produce the preResult calculateDynamicEPsaPost() needs.
//   postData     — PSA/imaging/confounder fields, fed to
//                  calculateDynamicEPsaPost(preResult, postData) alongside
//                  that preResult.
// `groundTruth` is the physician-panel reference decision — kept out of the
// wizard UI so it doesn't bias the physician taking the test; only surfaced
// in the results/comparison view.
//
// preFormData deliberately omits any Model 1 risk factor the case
// description doesn't mention (defaults to the same low-risk base() used in
// testCases.js) — the point of these cases is the Model 2 post-PSA logic
// (confounders, confirmation, red flags, life expectancy), not Model 1
// scoring, so preFormData is kept minimal and only carries what the
// spreadsheet's clinical description actually states.
const preBase = (overrides) => ({
  race: 'white',
  bmi: 24,
  ipss: [0, 0, 0, 0, 0, 0, 0],
  shim: [5, 5, 5, 5, 5],
  exercise: 0,
  familyHistory: 0,
  smoking: 0,
  brcaStatus: 'no',
  comorbidityScore: 0,
  ...overrides,
});

export const TEST_CASES_MODEL2 = [
  {
    id: 'P01',
    description: '57-year-old man. Age-adjusted PSA 1.6 ng/mL (below the 3.5 threshold), confirmed on a prior test. No family history, negative germline panel, asymptomatic (IPSS 3, SHIM 21). PSA density 0.08. Life expectancy >20 years.',
    groundTruth: 'Continue screening',
    preFormData: preBase({ age: 57, ipss: [1, 1, 1, 0, 0, 0, 0], shim: [4, 4, 4, 4, 5] }),
    postData: { psa: 1.6, psaConfirmed: true },
  },
  {
    id: 'P02',
    description: '63-year-old man. PSA 5.4 ng/mL, confirmed on repeat (5.2 → 5.4), above the age threshold (4.5). Prostate volume 34 cc → PSA density 0.16. No confounders, asymptomatic, no prior biopsy.',
    groundTruth: 'Refer to imaging (mpMRI)',
    preFormData: preBase({ age: 63 }),
    postData: { psa: 5.4, prostateVolume: 34, psaConfirmed: true },
  },
  {
    id: 'P03',
    description: '60-year-old man. Single PSA 4.9 ng/mL (above 4.5), not yet repeated. Completed a 90 km cycling event two days before the draw. Otherwise asymptomatic, no prior PSA on record.',
    groundTruth: 'Recheck — repeat PSA (unconfirmed single value)',
    preFormData: preBase({ age: 60 }),
    postData: { psa: 4.9, psaConfirmed: false, recentVigorousCycling: true },
  },
  {
    id: 'P04',
    description: '66-year-old man. PSA 4.7 ng/mL with dysuria and urinary frequency; urinalysis positive for infection. No prior elevated PSA.',
    groundTruth: 'Recheck — repeat PSA (confounder: UTI)',
    preFormData: preBase({ age: 66 }),
    postData: { psa: 4.7, psaConfirmed: true, urinarySymptomsInfection: true },
  },
  {
    id: 'P05',
    description: '45-year-old man, confirmed germline BRCA2. PSA 3.4 ng/mL, confirmed, above the BRCA-adjusted threshold of 3.0 (below the standard age band). PSA density 0.13, no confounders, asymptomatic.',
    groundTruth: 'Refer to imaging (mpMRI)',
    preFormData: preBase({ age: 45, brcaStatus: 'yes', familyHistory: 1 }),
    postData: { psa: 3.4, prostateVolume: 26.2, psaConfirmed: true },
  },
  {
    id: 'P06',
    description: '68-year-old man. PSA 28 ng/mL, confirmed. New back pain; hard, irregular prostate reported by GP. No infection on urinalysis.',
    groundTruth: 'Refer to urology (red flag: abnormal DRE)',
    preFormData: preBase({ age: 68 }),
    postData: { psa: 28, psaConfirmed: true, urologyRedFlagAbnormalDre: true },
  },
  {
    id: 'P07',
    description: '61-year-old man. PSA 6.2 ng/mL confirmed, with visible (gross) haematuria and hesitancy. Urinalysis negative for infection.',
    groundTruth: 'Refer to urology (red flag: hematuria)',
    preFormData: preBase({ age: 61 }),
    postData: { psa: 6.2, psaConfirmed: true, urologyRedFlagHematuria: true },
  },
  {
    id: 'P08',
    description: '59-year-old man on finasteride for 3 years. Measured PSA 2.1 ng/mL, but a confirmed rise from a treatment nadir of 0.9 → 2.1 (5-ARI-adjusted ≈ 4.2, above threshold). No confounders, asymptomatic.',
    groundTruth: 'Refer to imaging (mpMRI) — rise from nadir',
    preFormData: preBase({ age: 59 }),
    postData: { psa: 2.1, psaConfirmed: true, onHormonalTherapy: true, hormonalTherapyType: 'finasteride' },
  },
  {
    id: 'P09',
    description: '72-year-old man. PSA 5.1 ng/mL confirmed. Multiple comorbidities (CHF, CKD); estimated life expectancy 5–6 years. PSA density 0.12, asymptomatic.',
    groundTruth: 'Continue — limited life expectancy',
    preFormData: preBase({ age: 72, comorbidityScore: 2 }),
    postData: { psa: 5.1, prostateVolume: 42.5, psaConfirmed: true, hasTwoComorbidities: true },
  },
  {
    id: 'P10',
    description: '64-year-old man. PSA 4.6 ng/mL confirmed (just above 4.5). PSA density 0.10 and %free PSA 22% (both reassuring). No confounders, asymptomatic, no family history.',
    groundTruth: 'Recheck — repeat PSA (reassuring density)',
    preFormData: preBase({ age: 64 }),
    postData: { psa: 4.6, prostateVolume: 46, psaConfirmed: true },
  },
  {
    id: 'P11',
    description: '55-year-old man. First-ever PSA 3.8 ng/mL (above 3.5), not yet repeated. Asymptomatic, no risk factors, no confounders.',
    groundTruth: 'Recheck — repeat PSA (unconfirmed single value)',
    preFormData: preBase({ age: 55 }),
    postData: { psa: 3.8, psaConfirmed: false },
  },
  {
    id: 'P12',
    description: '67-year-old man. PSA 12 ng/mL confirmed. Prostate volume 43 cc → PSA density 0.28. No acute symptoms, no infection.',
    groundTruth: 'Refer to imaging (mpMRI)',
    preFormData: preBase({ age: 67 }),
    postData: { psa: 12, prostateVolume: 43, psaConfirmed: true },
  },
  {
    id: 'P13',
    description: '50-year-old man. PSA 4.0 ng/mL confirmed (above the 3.5 band). PSA density 0.14, PHI 42 (elevated). Father had prostate cancer at 62. No confounders, asymptomatic.',
    groundTruth: 'Refer to imaging (mpMRI)',
    preFormData: preBase({ age: 50, familyHistory: 1 }),
    postData: { psa: 4.0, prostateVolume: 28.6, psaConfirmed: true },
  },
  {
    id: 'P14',
    description: '70-year-old man. PSA 5.0 ng/mL confirmed, presenting with acute urinary retention requiring catheterisation.',
    groundTruth: 'Refer to urology (red flag: urinary retention)',
    preFormData: preBase({ age: 70 }),
    postData: { psa: 5.0, psaConfirmed: true, urologyRedFlagRetention: true },
  },
  {
    id: 'P15',
    description: '48-year-old man, confirmed germline HOXB13. PSA 2.9 ng/mL confirmed (below 3.0), PSA density 0.09, asymptomatic. High-risk genotype but PSA not yet elevated.',
    groundTruth: 'Continue screening',
    preFormData: preBase({ age: 48 }),
    postData: { psa: 2.9, prostateVolume: 32.2, psaConfirmed: true },
  },
  {
    id: 'P16',
    description: '62-year-old man. PSA 4.8 ng/mL, but a prostate biopsy was performed 3 weeks earlier (instrumentation). PSA density 0.15, asymptomatic.',
    groundTruth: 'Recheck — repeat PSA (confounder: recent biopsy)',
    preFormData: preBase({ age: 62 }),
    postData: { psa: 4.8, prostateVolume: 32, psaConfirmed: true, recentInstrumentation: true },
  },
];

export const DECISION_OPTIONS_MODEL2 = [
  'CONTINUE SCREENING',
  'RECHECK — REPEAT PSA',
  'REFER TO IMAGING (mpMRI)',
  'REFER TO UROLOGY',
  'CONTINUE — LIMITED LIFE EXPECTANCY',
];
