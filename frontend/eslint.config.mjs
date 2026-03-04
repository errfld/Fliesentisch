import { fixupConfigRules } from "@eslint/compat";
import nextConfig from "eslint-config-next";

const config = [
  { ignores: ["eslint.config.mjs", "next.config.mjs", "postcss.config.mjs"] },
  ...fixupConfigRules(nextConfig),
];

export default config;
