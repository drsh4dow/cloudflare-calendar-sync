import { defineConfig, lazyPlugins } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// TanStack Router regenerates the route tree on every dev and build run.
const generatedFiles = ["src/routeTree.gen.ts"];

const config = defineConfig({
  fmt: {
    ignorePatterns: [...generatedFiles],
  },
  lint: {
    ignorePatterns: [...generatedFiles],
    // Listing plugins replaces Oxlint's defaults (typescript, unicorn, oxc).
    plugins: ["typescript", "unicorn", "oxc", "react", "jsx-a11y", "import", "vitest"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
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
