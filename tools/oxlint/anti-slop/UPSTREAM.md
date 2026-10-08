# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit
`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10).

Installed on 2026-10-08 by running
`skills/install-anti-slop/scripts/install.mjs` from that commit, which copied
`skills/install-anti-slop/assets/anti-slop/` to this directory unchanged.

Installed entry points, registered in `vite.config.ts`:

- `index.ts`: the generic `anti-slop` plugin, all 18 rules at error.
- `effect/index.ts`: the opt-in `anti-slop-effect` plugin, all 5 rules at
  error, enabled because `effect` is a direct dependency.

`vendor/eslint-stylistic/UPSTREAM.md` records the provenance of the vendored
ESLint Stylistic rule; its `LICENSE` travels with it.

## Deviations

- Every import of `@oxlint/plugins` now imports `vite-plus/lint/plugins`. The
  project installs no standalone `oxlint` or `@oxlint/plugins`; Vite+ bundles
  Oxlint and re-exports the plugin API it ships with from that entry point.
  Only the import specifiers differ from upstream.
- Upstream tests against `oxlint` and `@oxlint/plugins` 1.78.0. Vite+ 1.1.0
  ships `oxlint` 1.87.0 with `@oxlint/plugins` 1.79.0.
- The project's `tsconfig.json` excludes this directory. Upstream type-checks
  it without `exactOptionalPropertyTypes` or
  `noPropertyAccessFromIndexSignature`, and two files fail under those flags.
  `vp check` skips it as well, because the lint ignore patterns cover it.
