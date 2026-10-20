import { describe, expect, it } from 'vitest';
import { changedFile, config, findingsOf } from '../../test/helpers.js';

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `const v${index} = ${index};`);

describe('pr-size analyzer', () => {
  it('warns above warnAt and raises the severity above failAt', () => {
    expect(findingsOf('pr-size', [changedFile('src/a.ts', lines(400))])).toEqual([]);
    expect(findingsOf('pr-size', [changedFile('src/a.ts', lines(401))])).toEqual([
      expect.objectContaining({
        severity: 'minor',
        message: expect.stringContaining('401 lignes modifiées (seuil : 400)'),
      }),
    ]);
    expect(
      findingsOf('pr-size', [changedFile('src/a.ts', lines(600), { deletions: 500 })]),
    ).toEqual([
      expect.objectContaining({
        severity: 'major',
        message: expect.stringContaining('1100 lignes modifiées (seuil : 1000)'),
      }),
    ]);
  });

  it('does not count lockfiles', () => {
    expect(
      findingsOf('pr-size', [
        changedFile('pnpm-lock.yaml', lines(5000)),
        changedFile('src/a.ts', lines(10)),
      ]),
    ).toEqual([]);
  });
});

describe('missing-tests analyzer', () => {
  it('flags code changes without any test change, naming a few files', () => {
    const findings = findingsOf('missing-tests', [
      changedFile('src/a.ts', lines(6)),
      changedFile('src/b.ts', lines(6)),
      changedFile('src/c.vue', lines(1)),
      changedFile('src/d.py', lines(1)),
      changedFile('README.md', lines(50)),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'minor',
        message: expect.stringContaining(
          '14 lignes de code ajoutées (`src/a.ts`, `src/b.ts`, `src/c.vue`…)',
        ),
      }),
    ]);
  });

  it('is satisfied by any test change, and ignores small or configuration changes', () => {
    expect(
      findingsOf('missing-tests', [
        changedFile('src/a.ts', lines(50)),
        changedFile('src/a.spec.ts', lines(1)),
      ]),
    ).toEqual([]);
    expect(findingsOf('missing-tests', [changedFile('src/a.ts', lines(9))])).toEqual([]);
    expect(findingsOf('missing-tests', [changedFile('vite.config.ts', lines(50))])).toEqual([]);
    const strict = config({
      analyzers: { 'missing-tests': { enabled: true, minChangedLines: 1 } },
    });
    expect(
      findingsOf('missing-tests', [changedFile('src/a.ts', lines(1))], { config: strict }),
    ).toHaveLength(1);
  });

  it('keeps a crafted file name from closing the code span', () => {
    const [finding] = findingsOf('missing-tests', [changedFile('src/`evil`.ts', lines(20))]);
    expect(finding?.message).toContain('`src/evil.ts`');
  });
});

describe('todo-comments analyzer', () => {
  it('flags TODO and FIXME comments without a ticket', () => {
    const findings = findingsOf('todo-comments', [
      changedFile('src/a.ts', [
        '// TODO handle refunds',
        'const total = sum(items); // FIXME rounding',
        '# HACK until the API is fixed',
        '// TODO(#42) handle refunds',
        '// TODO PAY-118 handle refunds',
        '// TODO https://tracker.example/issue/7',
        'const label = "TODO list";',
      ]),
    ]);
    expect(findings.map((finding) => [finding.line, finding.severity])).toEqual([
      [1, 'info'],
      [2, 'info'],
      [3, 'info'],
    ]);
    expect(findings[1]?.message).toMatch(/^FIXME sans référence de ticket/);
  });

  it('ignores documentation files', () => {
    expect(
      findingsOf('todo-comments', [changedFile('docs/roadmap.md', ['<!-- TODO write -->'])]),
    ).toEqual([]);
  });
});
