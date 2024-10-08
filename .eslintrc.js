module.exports = {
  parser: '@typescript-eslint/parser', // Specifies the ESLint parser
  extends: [
    'airbnb-base',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended', // Enables eslint-plugin-prettier and displays prettier errors as ESLint errors. Make sure this is always the last configuration in the extends array.
  ],
  plugins: ['jest'],
  parserOptions: {
    ecmaVersion: 2023, // Allows for the parsing of modern ECMAScript features
    sourceType: 'module', // Allows for the use of imports
    project: ['./tsconfig.json', './tsconfig.test.json'],
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.ts'],
      },
      typescript: {}, // This loads <rootdir>/tsconfig.json to eslint
    },
  },
  rules: {
    'prettier/prettier': 'error', // Add Prettier errors as ESLint errors
    'arrow-parens': ['error', 'as-needed'],
    'import/no-named-as-default': 0,
    'import/prefer-default-export': 0,
    quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    'comma-dangle': 0,
    'object-curly-newline': 'off', // This rule is better handled by prettier
    eqeqeq: [1, 'allow-null'],
    'no-console': 'off',
    'no-continue': 0,
    'no-cond-assign': 1,
    'no-constant-condition': 0,
    'no-control-regex': 1,
    'no-debugger': 1,
    'no-dupe-keys': 1,
    'no-ex-assign': 1,
    'no-extra-boolean-cast': 1,
    'no-func-assign': 1,
    'no-regex-spaces': 1,
    'no-unreachable': 1,
    'no-fallthrough': 1,
    'no-lone-blocks': 1,
    'no-delete-var': 1,
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'warn',
    'no-shadow-restricted-names': 1,
    'no-undef': 2,
    'no-undef-init': 1,
    'no-use-before-define': 0,
    'no-unused-vars': 'off', // This must be disabled for the typescript rule below to work
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        args: 'none', // We should change to args: after-used
        varsIgnorePattern: '^_', // Allow variables starting with _ to be unused
      },
    ],
    'no-underscore-dangle': 0,
    'no-restricted-syntax': ['error', 'LabeledStatement', 'WithStatement'],
    'no-await-in-loop': 'off',
    'no-plusplus': 'off',
    'guard-for-in': 'off',
    'no-bitwise': 'off',
    'import/extensions': [
      'error',
      'ignorePackages',
      {
        js: 'never',
        ts: 'never',
      },
    ],
    'jest/no-disabled-tests': 'off', // It's useful to have skipped tests on our suites

    /* These last rules would require a large effort and potentially cause breaking changes,
     * So they will be left out for now and dealt with separately.
     */
    camelcase: 'off', // Conflicts with variables obtained directly from the fullnode endpoints
    'import/no-cycle': 'off', // Needs more investigation to properly restructure the lib files
  },
  overrides: [
    {
      // Rules specific for source files
      files: ['src/**'],
      rules: {
        'no-console': 'error',
      }
    },
    {
      files: ['*.ts'],
      parserOptions: {
        project: ['./tsconfig.json'], // Specify it only for TypeScript files
      },
    },
    {
      // Apply Jest global variables only to test files
      files: ['__tests__/**/*.{js,ts}'],
      env: {
        jest: true,
      },
      plugins: ['jest'],
      extends: ['plugin:jest/recommended'], // Use recommended Jest rules
      rules: {
        'jest/no-disabled-tests': 'off', // It's useful to have skipped tests on our suites
        "jest/expect-expect": [
          'error',
          {
            assertFunctionNames: [
              'expect',
              'executeTests', // from NanoContracts bet tests
              'testUnlockWhenSpent', // from Nano contracts Storage tests
              'testLockedUtxoMethods', // from Common Store tests
              'testRegisteredTokens', // from Common Store tests
              'testScanningPolicies', // from Common Store tests
              'testBestUtxoSelection', // from utxo test
              'testFastUtxoSelection', // from utxo test
              'handleStopTest', // from storage test
              'processLockedUtxoTest', // from storage test
              'getChangeAddressTest', // from storage test
              'getAcctXprivTest', // from storage test
              'accessDataTest', // from storage test
              'checkPinTest', // from storage test
              'checkPasswdTest', // from storage test
              'testSelectUtxos', // from storage test
              'testScanningPolicy', // from storage test
            ],
          },
        ],
      },
    },
  ],
};
