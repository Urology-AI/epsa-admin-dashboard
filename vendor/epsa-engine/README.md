# @epsa/engine (vendored)

This is a **vendored snapshot** of the shared ePSA clinical calculator engine,
not a live dependency. It has to be vendored — Cloudflare Pages only checks
out this one repo into an isolated build container, so a `file:../epsa-engine`
sibling-directory dependency (which resolves fine locally) fails there. See
the "Vendor @epsa/engine into the repo instead of a sibling-directory path"
commit for the original incident.

Canonical source: [`Urology-AI/epsa-engine`](https://github.com/Urology-AI/epsa-engine).

## Keeping this in sync

Being a snapshot, this silently drifts from the canonical repo unless someone
re-syncs it. Use the sync script rather than copying files by hand:

```bash
# Check how stale the vendored copy is (reads the committed SYNC.json, no network needed)
npm run sync:engine:check

# Re-sync from a local checkout of epsa-engine (sibling dir, a worktree, or any branch)
npm run sync:engine -- /path/to/epsa-engine
# or: EPSA_ENGINE_SRC=/path/to/epsa-engine npm run sync:engine
```

This copies `epsaEngine.js`, `calculatorConfig.js`, `index.js`, `index.d.ts`,
`biopsyRisk.js`, and `version.js`, carries the source's `package.json` version
into `vendor/epsa-engine/package.json`, and writes `SYNC.json` recording what
was synced from where (source path, git SHA/branch if the source is a git
repo, and the timestamp) — so anyone reviewing a PR that touches this vendor
dir can see exactly what changed and where it came from, instead of a diff
with no provenance.

`sync:engine:check` can't reach across repos (same reason we vendor at all),
so it only reports on the already-committed `SYNC.json` — it's a "go check
manually" signal, not a build-breaking staleness gate.

After syncing, run the app's test suite / `npm run build` and review the
`vendor/epsa-engine/` diff before committing — this is still a manual,
reviewed step, just no longer an unrecorded one.
