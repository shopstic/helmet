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
    },
    languageOptions: {
      parserOptions: {
        project: `${__dirname}/tsconfig.json`,
      },
    }
  }
);
