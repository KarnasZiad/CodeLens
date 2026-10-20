import { describe, expect, it } from 'vitest';
import { changedFile, findingsOf } from '../../test/helpers.js';

const manifestPatch = [
  '@@ -10,8 +10,10 @@',
  '   "dependencies": {',
  '-    "express": "^4.21.0",',
  '+    "express": "^5.3.0",',
  '+    "left-pad": "^1.3.0",',
  '+    "@scope/util": "workspace:*",',
  '     "zod": "^4.6.7"',
  '   },',
  '   "scripts": {',
  '+    "test": "vitest run",',
  '     "build": "tsc"',
].join('\n');

describe('dependencies analyzer', () => {
  it('reports new dependencies, not upgrades, and asks for the lockfile', () => {
    const findings = findingsOf('dependencies', [
      changedFile('package.json', [], { patch: manifestPatch, additions: 4 }),
    ]);

    expect(findings.map((finding) => [finding.rule, finding.severity, finding.line])).toEqual([
      ['lockfile-not-updated', 'major', undefined],
      ['new-dependency', 'info', 12],
      ['new-dependency', 'info', 13],
    ]);
    expect(findings[1]?.message).toContain('« left-pad » (^1.3.0)');
    expect(findings[2]?.message).toContain('« @scope/util » (workspace:*)');
  });

  it('is satisfied when the lockfile changes too', () => {
    const findings = findingsOf('dependencies', [
      changedFile('apps/api/package.json', [], { patch: manifestPatch }),
      changedFile('pnpm-lock.yaml', ['lockfileVersion: 9.0']),
    ]);
    expect(findings.map((finding) => finding.rule)).toEqual(['new-dependency', 'new-dependency']);
  });

  it('counts a removed dependency as a manifest change', () => {
    const patch = ['@@ -3,2 +3,1 @@', '-    "left-pad": "^1.3.0",', '     "zod": "^4.6.7"'].join(
      '\n',
    );
    expect(
      findingsOf('dependencies', [changedFile('package.json', [], { patch })]).map(
        (finding) => finding.rule,
      ),
    ).toEqual(['lockfile-not-updated']);
  });

  it('ignores scripts, engines, the package version and other JSON files', () => {
    const findings = findingsOf('dependencies', [
      changedFile('package.json', [
        '  "version": "1.2.0",',
        '    "node": ">=22",',
        '    "lint": "eslint ."',
      ]),
      changedFile('tsconfig.json', ['    "target": "ES2023"', '    "foo": "^1.0.0"']),
    ]);
    expect(findings).toEqual([]);
  });
});
