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
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  resolve: { tsconfigPaths: true },
  plugins: lazyPlugins(() => [devtools(), tailwindcss(), tanstackStart(), viteReact()]),
});

export default config;
