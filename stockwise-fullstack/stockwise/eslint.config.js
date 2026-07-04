import js from "@eslint/js";

export default [
  { ignores: ["js/*.js", "dist/", "node_modules/", ".venv/", "ml_engine/", "backups/"] },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-empty": ["warn", { "allowEmptyCatch": true }],
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        Date: "readonly",
        Math: "readonly",
        String: "readonly",
        Number: "readonly",
        Boolean: "readonly",
        parseFloat: "readonly",
        import: "readonly",
      },
    },
  },
];
