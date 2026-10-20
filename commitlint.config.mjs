/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'api',
        'worker',
        'web',
        'engine',
        'analyzers',
        'gate',
        'github',
        'webhooks',
        'auth',
        'db',
        'infra',
        'ci',
        'deps',
        'docs',
      ],
    ],
  },
};
