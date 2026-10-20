import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, parseConfig } from './config.js';

describe('parseConfig', () => {
  it('uses the defaults when the repository has no configuration', () => {
    expect(parseConfig(null)).toEqual({ ok: true, config: DEFAULT_CONFIG, source: 'default' });
    expect(DEFAULT_CONFIG.gate.maxFindings).toEqual({
      blocker: 0,
      critical: 0,
      major: null,
      minor: null,
      info: null,
    });
    expect(DEFAULT_CONFIG.analyzers.complexity).toEqual({ enabled: true, threshold: 10 });
  });

  it('merges a partial file with the defaults', () => {
    const result = parseConfig(
      [
        'ignore: ["**/*.generated.ts"]',
        'analyzers:',
        '  complexity:',
        '    threshold: 15',
        '  todo-comments:',
        '    enabled: false',
        'gate:',
        '  maxFindings:',
        '    major: 3',
        '    critical: null',
      ].join('\n'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('file');
    expect(result.config.ignore).toEqual(['**/*.generated.ts']);
    expect(result.config.analyzers.complexity).toEqual({ enabled: true, threshold: 15 });
    expect(result.config.analyzers['todo-comments'].enabled).toBe(false);
    expect(result.config.analyzers.secrets.enabled).toBe(true);
    // Setting one limit keeps the other defaults; null lifts a limit explicitly.
    expect(result.config.gate.maxFindings).toMatchObject({ blocker: 0, critical: null, major: 3 });
  });

  it('accepts an empty file', () => {
    expect(parseConfig('')).toMatchObject({ ok: true, config: DEFAULT_CONFIG });
    expect(parseConfig('# nothing yet\n')).toMatchObject({ ok: true, config: DEFAULT_CONFIG });
  });

  it('reports every schema error in French with its key and line', () => {
    const result = parseConfig(
      [
        'analyzers:',
        '  complexity:',
        '    threshold: 1',
        '  unknown-rule: {}',
        'gate:',
        '  maxFindings:',
        '    blocker: -1',
      ].join('\n'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'analyzers.complexity.threshold',
          line: 3,
          message: expect.stringContaining('Trop petit'),
        }),
        expect.objectContaining({
          path: 'analyzers',
          message: expect.stringContaining('unknown-rule'),
        }),
        expect.objectContaining({ path: 'gate.maxFindings.blocker', line: 7 }),
      ]),
    );
  });

  it('checks the consistency of the size thresholds', () => {
    const result = parseConfig('analyzers:\n  pr-size:\n    warnAt: 500\n    failAt: 100\n');
    expect(result).toMatchObject({
      ok: false,
      errors: [
        { path: 'analyzers.pr-size.failAt', message: 'failAt doit être supérieur à warnAt' },
      ],
    });
  });

  it('reports invalid YAML with its line', () => {
    const result = parseConfig('analyzers:\n  complexity: [unclosed\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/^YAML invalide/);
    expect(result.errors[0]?.line).toBeGreaterThan(0);
  });

  it('rejects duplicate keys instead of silently keeping the last one', () => {
    expect(parseConfig('ignore: []\nignore: ["a"]\n').ok).toBe(false);
  });

  it('refuses alias bombs and oversized files', () => {
    const bomb = [
      'a: &a ["x","x","x","x","x","x","x","x","x","x"]',
      ...Array.from({ length: 8 }, (_, index) => {
        const name = String.fromCharCode(98 + index);
        const previous = String.fromCharCode(97 + index);
        return `${name}: &${name} [${Array.from({ length: 10 }, () => `*${previous}`).join(',')}]`;
      }),
    ].join('\n');
    expect(parseConfig(bomb)).toMatchObject({ ok: false });
    expect(parseConfig(`ignore: ["${'a'.repeat(70 * 1024)}"]`)).toMatchObject({
      ok: false,
      errors: [{ message: 'Fichier trop volumineux (64 Ko maximum).' }],
    });
  });
});
