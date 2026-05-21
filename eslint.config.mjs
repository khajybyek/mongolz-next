import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      ".next.nosync/**",       // iCloud Drive .nosync mirror (local dev)
      "node_modules/**",
      "node_modules.nosync/**", // iCloud Drive .nosync mirror — else eslint
                                // scans the whole dependency tree locally
      "**/*.nosync/**",        // any other iCloud-spawned .nosync dirs
      ".claude/**",            // agent git worktrees — repo copies, not source
      "ml-service/**",
      "supabase/functions/**",
      "scripts/**",
      "thesis/**",       // Standalone Node generators (docx/pptx) — use require()
      "e2e/**",          // Playwright E2E specs — separate tsconfig
      "playwright.config.ts",
      "next-env.d.ts",
      "*.config.*",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-undef": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
);
