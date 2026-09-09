/**
 * version.js — package-level version metadata for audit-trail/SaMD
 * reproducibility: every assessment persisted by a consumer should be able
 * to point back at exactly which engine build and which guideline edition
 * produced it.
 *
 * ENGINE_VERSION must be bumped in lockstep with package.json's "version" —
 * there's no build step that derives one from the other (this package has no
 * bundler), so treat a package.json version bump and this constant as one
 * change. Per-model versions (e.g. calculateDynamicEPsa's own `modelVersion`
 * from calculatorConfig.js, or BIOPSY_MODEL_VERSION in biopsyRisk.js) are
 * separate from this — ENGINE_VERSION identifies the package release as a
 * whole, not any one model inside it.
 */
export const ENGINE_VERSION = '0.2.5';

// The clinical guideline edition the engine's thresholds/guardrails are
// currently anchored to (see AUA_PSA_THRESHOLDS and checkGuardrails in
// epsaEngine.js, and the biopsy model's GUIDELINE_RATES in biopsyRisk.js).
export const GUIDELINE_VERSION = 'AUA/SUO 2026';
