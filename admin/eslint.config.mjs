import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These files are generated mirrors of the native Mini Program kernel.
    // Keep their CommonJS module contract byte-compatible with the source.
    files: ["src/lib/survey-runtime/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated camera builds, release artifacts and pinned vendor bundles.
    ".next-camera/**",
    ".next-camera-build/**",
    "public/construction-camera/vendor/**",
    "release/**",
    "tmp/**",
  ]),
]);

export default eslintConfig;
