const { execSync } = require("node:child_process");
const { dirname } = require("node:path");

const whichEslint = execSync("which eslint");
const eslintPath = dirname(dirname(whichEslint.toString().trim()));
const tseslint = require(`${eslintPath}/node_modules/typescript-eslint/dist/index.js`);

module.exports = tseslint.config(
  ...tseslint.configs.recommended.map(({ rules, ...rest }) => rest),
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error"
    },
    languageOptions: {
      parserOptions: {
        project: `${__dirname}/tsconfig.eslint.json`,
      },
    }
  }
);
