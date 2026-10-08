import { defineConfig, lazyPlugins } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Files this project doesn't author: TanStack Router's generated route tree,
// the vendored anti-slop plugin, and agent tooling directories.
const unownedFiles = [
  "src/routeTree.gen.ts",
  "tools/oxlint/anti-slop/**",
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".windsurf/**",
];

const config = defineConfig({
  fmt: {
    ignorePatterns: unownedFiles,
  },
  lint: {
    ignorePatterns: unownedFiles,
    // Listing plugins replaces Oxlint's defaults (typescript, unicorn, oxc).
    plugins: ["typescript", "unicorn", "oxc", "react", "jsx-a11y", "import", "vitest"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
      { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "oxc/no-accumulating-spread": "error",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
      "anti-slop-effect/no-manual-effect-error-tag": "error",
      "anti-slop-effect/no-manual-tag-comparison": "error",
      "anti-slop-effect/no-manual-tagged-construction": "error",
      "anti-slop-effect/no-service-constructor-imports": "error",
      "anti-slop-effect/prefer-effect-match": "error",
      // The automatic JSX runtime (tsconfig `jsx: react-jsx`) needs no React in scope.
      "react/react-in-jsx-scope": "off",
    },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    // Remove once the first test lands; until then Vitest fails on an empty run.
    passWithNoTests: true,
  },
  resolve: { tsconfigPaths: true },
  // lazyPlugins returns undefined while Vite+ reads only the lint, fmt, or test
  // block, and its return type rejects that under exactOptionalPropertyTypes.
  plugins: lazyPlugins(() => [devtools(), tailwindcss(), tanstackStart(), viteReact()]) ?? [],
});

export default config;
