#!/usr/bin/env node
/**
 * Syncs vendor/epsa-engine/ from a local checkout of the canonical
 * Urology-AI/epsa-engine repo (or any other source carrying the same file
 * layout — e.g. e-psa/frontend/vendor/epsa-engine, the production-
 * authoritative copy this vendor dir was originally seeded from).
 *
 * WHY THIS EXISTS: vendor/epsa-engine/ can't be an npm/file: dependency on
 * a sibling directory (see the "Vendor @epsa/engine into the repo instead
 * of a sibling-directory path" commit) — Cloudflare Pages only checks out
 * this one repo, so anything outside it doesn't exist at build time. That
 * means the vendored copy is a snapshot, not a live link, and it silently
 * drifts unless someone re-syncs it. Before this script, that resync was
 * "manually copy files and hope you got them all" with no record of what
 * was actually copied from where — which is exactly how this vendor dir
 * ended up ~590 lines behind its source with entire files (biopsyRisk.js,
 * version.js) missing outright.
 *
 * WHAT THIS SCRIPT DOES NOT DO: it cannot reach across repos in CI (same
 * reason we vendor at all — Cloudflare Pages only checks out this repo).
 * So this is a dev-machine tool: run it locally when you know the source
 * has moved on, commit the result, open a PR. `--check` mode is the CI-safe
 * half — it only reads the recorded provenance file already committed
 * here and tells you how old it is; it does not need network or sibling-
 * repo access, so it's safe to run in Cloudflare Pages' build step too.
 *
 * Usage:
 *   node scripts/sync-epsa-engine.mjs [source-path]
 *     source-path defaults to $EPSA_ENGINE_SRC or ../../epsa-engine
 *     (relative to this repo's root — i.e. a sibling checkout).
 *
 *   node scripts/sync-epsa-engine.mjs --check
 *     No source needed. Reads vendor/epsa-engine/SYNC.json (committed) and
 *     warns (exit 0) if the recorded sync looks stale (>30 days), or if
 *     SYNC.json is missing (pre-dates this script). Does not fail the
 *     build — staleness here is a "go check" signal, not a broken build.
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const VENDOR_DIR = join(REPO_ROOT, 'vendor/epsa-engine');
const SYNC_META_PATH = join(VENDOR_DIR, 'SYNC.json');

// Files copied 1:1 from the source engine's src/ into vendor/epsa-engine/src/.
// Keep in sync with whatever @epsa/engine's own src/ exports — see its
// src/index.js for the authoritative list of what's actually re-exported.
const SYNCED_FILES = [
  'src/epsaEngine.js',
  'src/calculatorConfig.js',
  'src/index.js',
  'src/index.d.ts',
  'src/biopsyRisk.js',
  'src/version.js',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitInfo(dir) {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: dir }).toString().trim().length > 0;
    return { sha, branch, dirty };
  } catch {
    return null; // source isn't a git repo (or git isn't available) — sync still works, just unrecorded provenance
  }
}

function runCheck() {
  if (!existsSync(SYNC_META_PATH)) {
    console.log(
      'vendor/epsa-engine/SYNC.json not found — this vendored copy predates provenance tracking.\n' +
      'Run `node scripts/sync-epsa-engine.mjs <path-to-epsa-engine-checkout>` to sync and record it.'
    );
    return;
  }
  const meta = readJson(SYNC_META_PATH);
  const syncedAt = new Date(meta.syncedAt);
  const ageDays = Math.floor((Date.now() - syncedAt.getTime()) / 86_400_000);
  console.log(`vendor/epsa-engine last synced ${meta.syncedAt} (${ageDays}d ago)`);
  console.log(`  source: ${meta.sourcePath}`);
  if (meta.sourceGit) {
    console.log(`  source commit: ${meta.sourceGit.sha} (${meta.sourceGit.branch})${meta.sourceGit.dirty ? ' [dirty working tree at sync time]' : ''}`);
  } else {
    console.log('  source commit: unknown (source was not a git repo at sync time)');
  }
  console.log(`  engineVersion recorded: ${meta.engineVersion}`);
  if (ageDays > 30) {
    console.log(`\n⚠ Sync is over 30 days old. If Urology-AI/epsa-engine has moved on, re-run this script against a fresh checkout.`);
  }
}

function runSync(sourceArg) {
  const sourcePath = resolve(sourceArg || process.env.EPSA_ENGINE_SRC || join(REPO_ROOT, '../../epsa-engine'));
  if (!existsSync(sourcePath)) {
    console.error(`Source path does not exist: ${sourcePath}`);
    console.error('Pass the path explicitly, e.g.:');
    console.error('  node scripts/sync-epsa-engine.mjs /Users/you/epsa-engine');
    console.error('or set EPSA_ENGINE_SRC.');
    process.exit(1);
  }

  const missing = SYNCED_FILES.filter((f) => !existsSync(join(sourcePath, f)));
  if (missing.length) {
    console.error(`Source is missing expected file(s), refusing to sync a partial copy:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }

  for (const rel of SYNCED_FILES) {
    const dest = join(VENDOR_DIR, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(sourcePath, rel), dest);
    console.log(`  copied ${rel}`);
  }

  // Carry the source's package.json version into the vendored one, so
  // `npm ls @epsa/engine` in this repo actually reflects what's vendored
  // instead of the permanently-stuck "0.1.0" it was frozen at before.
  const sourcePkg = readJson(join(sourcePath, 'package.json'));
  const vendorPkgPath = join(VENDOR_DIR, 'package.json');
  const vendorPkg = readJson(vendorPkgPath);
  vendorPkg.version = sourcePkg.version;
  writeFileSync(vendorPkgPath, JSON.stringify(vendorPkg, null, 2) + '\n');
  console.log(`  vendor/epsa-engine/package.json version -> ${sourcePkg.version}`);

  let engineVersion = null;
  try {
    engineVersion = readFileSync(join(sourcePath, 'src/version.js'), 'utf8').match(/ENGINE_VERSION = '([^']+)'/)?.[1] ?? null;
  } catch { /* version.js always exists per SYNCED_FILES check above; ignore parse failure */ }

  const meta = {
    syncedAt: new Date().toISOString(),
    sourcePath,
    sourceGit: gitInfo(sourcePath),
    packageVersion: sourcePkg.version,
    engineVersion,
  };
  writeFileSync(SYNC_META_PATH, JSON.stringify(meta, null, 2) + '\n');
  console.log(`\nWrote ${SYNC_META_PATH}`);
  console.log('Now run the admin-dashboard test suite and diff vendor/epsa-engine/ before committing.');
}

const args = process.argv.slice(2);
if (args[0] === '--check') {
  runCheck();
} else {
  runSync(args[0]);
}
