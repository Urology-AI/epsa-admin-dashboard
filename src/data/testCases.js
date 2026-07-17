// ePSA Model 1 test sequence — physician ground-truth validation set.
// Source: "ePSA test sequence.xlsx" (Test Cases sheet) + "ePSA_Scoring_Tool.xlsx"
// (confirms the point weights below match the manual scoring tool 1:1).
//
// `formData` is the exact shape @epsa/engine's calculateDynamicEPsa() expects —
// used to call the live engine instead of trusting a spreadsheet snapshot.
// `groundTruth` is the physician-panel reference decision — kept out of the
// wizard UI so it doesn't bias the physician taking the test; only surfaced
// in the results/comparison view.

const base = (overrides) => ({
  race: 'white',
  bmi: 24,
  ipss: [0, 0, 0, 0, 0, 0, 0],
  shim: [5, 5, 5, 5, 5],
  exercise: 0,          // 0 regular, 1 some, 2 none
  familyHistory: 0,      // 0 no, 1 yes (first-degree prostate cancer)
  smoking: 0,             // 0 never, 1 former, 2 current
  brcaStatus: 'no',
  comorbidityScore: 0,    // 0, 1, 2 (2 = max tier)
  ...overrides,
});

// Distributes a target ordinal total across the 7 IPSS (0-5 each) or 5 SHIM (0-5 each) slots.
function spread(total, slots) {
  const arr = new Array(slots).fill(0);
  let remaining = total;
  for (let i = 0; i < slots && remaining > 0; i++) {
    const v = Math.min(5, remaining);
    arr[i] = v;
    remaining -= v;
  }
  return arr;
}

export const TEST_CASES = [
  {
    id: 'C01',
    description: '45-year-old white man. Excellent general health, life expectancy well over 10 years. No family history of prostate or any hereditary cancer. No urinary symptoms (IPSS 2), normal erectile function (SHIM 22). Non-smoker, BMI 24, exercises regularly, balanced diet, no occupational exposures, no comorbidities.',
    groundTruth: 'NO SCREEN - below screening age, no risk factors',
    formData: base({ age: 45, ipss: spread(2, 7), shim: spread(22, 5) }),
  },
  {
    id: 'C02',
    description: '65-year-old Black man. Father diagnosed with prostate cancer at 68. Good health, life expectancy >10 years. Mild urinary symptoms (IPSS 5), SHIM 18. Never smoked, BMI 27, some exercise, no comorbidities. Requests informed screening.',
    groundTruth: 'SCREEN - in-window age + two elevated-risk factors (Black, family history)',
    formData: base({ age: 65, race: 'black', bmi: 27, ipss: spread(5, 7), shim: spread(18, 5), exercise: 1, familyHistory: 1 }),
  },
  {
    id: 'C03',
    description: '30-year-old man, no symptoms, no family history, no risk factors, excellent health.',
    groundTruth: 'NO SCREEN - far below any screening age',
    formData: base({ age: 30, shim: spread(25, 5) }),
  },
  {
    id: 'C04',
    description: "43-year-old man, confirmed germline BRCA2 mutation. Father AND brother both had prostate cancer (brother at 49). Healthy otherwise, asymptomatic. Below the model's youngest age band (no age points apply).",
    groundTruth: 'SCREEN NOW - NCCN/AUA advise baseline screening from age 40 for BRCA2 carriers',
    formData: base({ age: 43, brcaStatus: 'yes', familyHistory: 1, shim: spread(25, 5) }),
  },
  {
    id: 'C05',
    description: '82-year-old man with severe lower urinary tract symptoms (IPSS 24) and erectile dysfunction (SHIM 8). Three significant comorbidities (CHF, COPD, CKD); estimated life expectancy under 5 years. Overtly symptomatic and clearly beyond screening age.',
    groundTruth: 'NO SCREEN - life expectancy <10 yr; symptoms need diagnostic work-up, not screening PSA',
    formData: base({ age: 82, ipss: spread(24, 7), shim: spread(8, 5), comorbidityScore: 2 }),
  },
  {
    id: 'C06',
    description: '72-year-old man, very fit, estimated life expectancy >15 years. Brother had prostate cancer. Asymptomatic (IPSS 3, SHIM 20). No comorbidities.',
    groundTruth: 'INDIVIDUALIZED - USPSTF recommends against at 70+; NCCN/AUA may continue if healthy',
    formData: base({ age: 72, familyHistory: 1, ipss: spread(3, 7), shim: spread(20, 5) }),
  },
  {
    id: 'C07',
    description: '52-year-old Black man. No family history, asymptomatic, healthy. No other risk factors.',
    groundTruth: 'BORDERLINE - AUA/NCCN offer screening 45-50 for Black men; USPSTF window starts at 55',
    formData: base({ age: 52, race: 'black', shim: spread(25, 5) }),
  },
  {
    id: 'C08',
    description: '54-year-old white man, no risk factors, asymptomatic, healthy, wants a check-up.',
    groundTruth: 'BORDERLINE - USPSTF window starts at 55; AUA may begin discussion at 50',
    formData: base({ age: 54, shim: spread(25, 5) }),
  },
  {
    id: 'C09',
    description: '70-year-old man, healthy, life expectancy >10 years, no family history, asymptomatic.',
    groundTruth: 'BORDERLINE - USPSTF recommends against at 70+; NCCN/AUA individualize to ~75 if healthy',
    formData: base({ age: 70, shim: spread(25, 5) }),
  },
  {
    id: 'C10',
    description: '54-year-old white man who turns 55 in three months. No risk factors, asymptomatic, healthy. Sits one age-band below the USPSTF threshold.',
    groundTruth: 'NOT YET - one year short of USPSTF window; revisit at 55',
    formData: base({ age: 54, shim: spread(25, 5) }),
  },
  {
    id: 'C11',
    description: '48-year-old man. Documented Lynch syndrome (MMR mutation) in the family; mother had colorectal cancer at 45. BRCA-negative. Asymptomatic, healthy.',
    groundTruth: 'CONSIDER SCREEN - hereditary cancer syndrome warrants genetic counseling + earlier screening (NCCN/AUA)',
    formData: base({ age: 48, shim: spread(25, 5) }), // model has no Lynch/MMR field — known gap
  },
  {
    id: 'C12',
    description: "50-year-old man whose father died of pancreatic cancer at 60; genetic testing not yet done. Asymptomatic, healthy.",
    groundTruth: 'CONSIDER SCREEN - hereditary-cancer family history; genetic counseling + earlier screening (NCCN/AUA)',
    formData: base({ age: 50, shim: spread(25, 5) }), // model only captures prostate FH — known gap
  },
  {
    id: 'C13',
    description: '45-year-old man with a confirmed germline HOXB13 mutation. No BRCA. Asymptomatic, healthy.',
    groundTruth: 'SCREEN - NCCN/AUA advise baseline screening from age 40 for high-risk germline variants',
    formData: base({ age: 45, shim: spread(25, 5) }), // model only captures BRCA1/2 — known gap
  },
  {
    id: 'C14',
    description: '46-year-old man of Ashkenazi Jewish ancestry; mother had breast cancer at 44. Not yet genetically tested. Asymptomatic.',
    groundTruth: 'CONSIDER SCREEN - BRCA-associated risk profile; genetic counseling + earlier screening (NCCN)',
    formData: base({ age: 46, shim: spread(25, 5) }), // ancestry/family-breast-cancer not captured — known gap
  },
  {
    id: 'C15',
    description: "49-year-old man, obese (BMI 33), current smoker, sedentary (no exercise). No family history, no hereditary risk, asymptomatic. Just below the model's youngest age band.",
    groundTruth: 'NO SCREEN - too young, no guideline-recognized risk factor; lifestyle factors are not screening triggers',
    formData: base({ age: 49, bmi: 33, smoking: 2, exercise: 2, shim: spread(25, 5) }),
  },
  {
    id: 'C16',
    description: '58-year-old man with erectile dysfunction (SHIM 9) and urinary symptoms (IPSS 12), but NO family history and no hereditary or demographic risk factors. Otherwise healthy.',
    groundTruth: 'SHARED DECISION - age-appropriate discussion; symptoms warrant clinical work-up, not screening weight',
    formData: base({ age: 58, ipss: spread(12, 7), shim: spread(9, 5) }),
  },
  {
    id: 'D01',
    description: '44-year-old white man. One second-degree relative (paternal uncle) had prostate cancer at 75. Full germline panel negative (BRCA, HOXB13, ATM, CHEK2, MMR). No hereditary-cancer family history. Asymptomatic, excellent health, life expectancy >30 years.',
    groundTruth: 'DISCUSS - Not indicated per guidelines - suggest discussion',
    formData: base({ age: 44, shim: spread(25, 5) }), // second-degree relative — familyHistory stays 0 (model = first-degree)
  },
  {
    id: 'D02',
    description: '44-year-old Black man. No family history, negative germline panel, asymptomatic, healthy, life expectancy >30 years. Turns 45 in two months.',
    groundTruth: 'DISCUSS - Not indicated per guidelines - suggest discussion',
    formData: base({ age: 44, race: 'black', shim: spread(25, 5) }),
  },
  {
    id: 'D03',
    description: '71-year-old man, exceptionally fit, no comorbidities, life expectancy >15 years. No family history, negative germline panel, asymptomatic. Strong personal wish to be screened.',
    groundTruth: 'DISCUSS - Not indicated per guidelines - suggest discussion',
    formData: base({ age: 71, shim: spread(25, 5) }),
  },
  {
    id: 'D04',
    description: "54-year-old white man, no risk factors, negative germline panel, asymptomatic, healthy, life expectancy >20 years. Anxious after a friend's diagnosis, requesting a PSA. Turns 55 in four months.",
    groundTruth: 'DISCUSS - Not indicated per guidelines - suggest discussion',
    formData: base({ age: 54, shim: spread(25, 5) }),
  },
  {
    id: 'D05',
    description: '48-year-old man. Father diagnosed with LOW-GRADE prostate cancer at 79 (indolent, untreated). Negative germline panel, no other affected relatives, no hereditary syndrome. Asymptomatic, healthy, life expectancy >25 years.',
    groundTruth: 'DISCUSS - Not indicated per guidelines - suggest discussion',
    formData: base({ age: 48, familyHistory: 1, shim: spread(25, 5) }),
  },
];

export const DECISION_OPTIONS = [
  'SCREEN',
  'NO SCREEN',
  'BORDERLINE / INDIVIDUALIZE',
  'SHARED DECISION-MAKING',
  'NOT YET',
  'CONSIDER SCREEN (genetic counseling)',
];
