import { describe, expect, it } from 'vitest';
import { changedFile, FAKE, findingsOf } from '../../test/helpers.js';
import { entropy } from './secrets.js';

describe('secrets analyzer', () => {
  it.each([
    ['aws-access-key', `const key = '${FAKE.awsKeyId}';`],
    ['github-token', `GITHUB_TOKEN=${FAKE.githubToken}`],
    ['slack-token', `slack: ${FAKE.slackToken}`],
    ['stripe-key', `stripe.setKey("${FAKE.stripeKey}")`],
    ['google-api-key', `"apiKey": "${FAKE.googleKey}"`],
    ['private-key', FAKE.privateKeyHeader],
  ])('detects %s as a blocker', (rule, line) => {
    const findings = findingsOf('secrets', [changedFile('src/config.ts', ['', line])]);

    expect(findings).toEqual([
      expect.objectContaining({ rule, severity: 'blocker', path: 'src/config.ts', line: 2 }),
    ]);
  });

  it('never copies the secret, even partially, into the finding', () => {
    const findings = findingsOf('secrets', [
      changedFile('src/a.ts', [
        `const token = "${FAKE.githubToken}";`,
        `const password = "${FAKE.password}";`,
      ]),
    ]);

    expect(findings).toHaveLength(2);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain(FAKE.githubToken.slice(4, 16));
    expect(serialized).not.toContain(FAKE.password.slice(0, 6));
  });

  it('detects hard-coded credentials with random-looking values', () => {
    const findings = findingsOf('secrets', [
      changedFile('src/db.ts', [
        `const password = "${FAKE.password}";`,
        `client_secret: '${FAKE.password}x'`,
        `apiKey = "${FAKE.password}y"`,
      ]),
    ]);
    expect(findings.map((finding) => finding.rule)).toEqual([
      'hardcoded-credential',
      'hardcoded-credential',
      'hardcoded-credential',
    ]);
  });

  it('ignores placeholders, environment lookups and low-entropy values', () => {
    const findings = findingsOf('secrets', [
      changedFile('src/db.ts', [
        'const password = "changeme123";',
        'const password = "your-password-here";',
        'const secret = "${process.env.SECRET}";',
        'const password = "aaaaaaaaaaaa";',
        'const apiKey = "<YOUR_API_KEY>";',
        'const password = process.env.DB_PASSWORD;',
        'passwordLabel: "Mot de passe"',
      ]),
    ]);
    expect(findings).toEqual([]);
  });

  it('skips credential assignments in test files, but not provider tokens', () => {
    const findings = findingsOf('secrets', [
      changedFile('src/auth.spec.ts', [
        `const password = "${FAKE.password}";`,
        `const key = "${FAKE.awsKeyId}";`,
      ]),
    ]);
    expect(findings.map((finding) => finding.rule)).toEqual(['aws-access-key']);
  });

  it('only looks at added lines', () => {
    const patch = ['@@ -1,2 +1,1 @@', `-const key = '${FAKE.awsKeyId}';`, ' const ok = true;'].join(
      '\n',
    );
    expect(findingsOf('secrets', [changedFile('src/a.ts', [], { patch })])).toEqual([]);
  });
});

describe('entropy', () => {
  it('scores random strings above words', () => {
    expect(entropy('aaaaaaaa')).toBe(0);
    expect(entropy('password')).toBeLessThan(3);
    expect(entropy(FAKE.password)).toBeGreaterThan(3.5);
  });
});
