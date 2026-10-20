import { describe, expect, it } from 'vitest';
import { changedFile, config, FAKE, PULL_REQUEST } from '../test/helpers.js';
import type { Analyzer } from './analyzers/analyzer.js';
import { DEFAULT_ANALYZERS } from './analyzers/index.js';
import { DEFAULT_CONFIG } from './config.js';
import { filesNeedingContent, MAX_FINDINGS, runReview } from './engine.js';

const review = (
  files: Parameters<typeof runReview>[0]['files'],
  cfg = DEFAULT_CONFIG,
  extra = {},
) => runReview({ pullRequest: PULL_REQUEST, files, ...extra }, cfg);

describe('runReview', () => {
  it('runs every analyzer, sorts findings by severity and applies the gate', () => {
    const result = review([
      changedFile('src/cart.ts', ['// TODO later', 'debugger;', `const key = "${FAKE.awsKeyId}";`]),
      changedFile('src/cart.spec.ts', ["it.only('x', () => {});"]),
    ]);

    expect(result.findings.map((finding) => finding.severity)).toEqual([
      'blocker',
      'critical',
      'major',
      'info',
    ]);
    expect(result.counts).toEqual({ info: 1, minor: 0, major: 1, critical: 1, blocker: 1 });
    expect(result.gate.status).toBe('failed');
    expect(result.analyzers.map((run) => run.id)).toEqual(
      DEFAULT_ANALYZERS.map((analyzer) => analyzer.id),
    );
    expect(result.stats).toEqual({
      files: 2,
      analyzedFiles: 2,
      ignoredFiles: 0,
      additions: 4,
      deletions: 0,
      partial: false,
    });
  });

  it('passes a clean pull request', () => {
    const result = review([
      changedFile('src/a.ts', ['export const a = 1;']),
      changedFile('src/a.spec.ts', ['it("a", () => {});']),
    ]);
    expect(result.findings).toEqual([]);
    expect(result.gate.status).toBe('passed');
  });

  it('skips removed and ignored files', () => {
    const cfg = config({ ignore: ['**/*.generated.ts'] });
    const result = review(
      [
        changedFile('src/api.generated.ts', ['debugger;']),
        changedFile('src/old.ts', ['debugger;'], { status: 'removed' }),
        changedFile('src/new.ts', ['debugger;']),
      ],
      cfg,
    );
    expect(result.findings.map((finding) => finding.path)).toEqual(['src/new.ts']);
    expect(result.stats).toMatchObject({ files: 3, analyzedFiles: 1, ignoredFiles: 1 });
  });

  it('does not run disabled analyzers', () => {
    const cfg = config({ analyzers: { ...DEFAULT_CONFIG.analyzers, secrets: { enabled: false } } });
    const result = review([changedFile('src/a.ts', [`const key = "${FAKE.awsKeyId}";`])], cfg);
    expect(result.analyzers.map((run) => run.id)).not.toContain('secrets');
    expect(result.findings).toEqual([]);
  });

  it('isolates an analyzer that throws', () => {
    const broken: Analyzer = {
      id: 'complexity',
      description: 'broken',
      analyze: () => {
        throw new Error('parser crashed');
      },
    };
    const result = runReview(
      { pullRequest: PULL_REQUEST, files: [changedFile('src/a.ts', ['debugger;'])] },
      DEFAULT_CONFIG,
      {
        analyzers: [
          broken,
          ...DEFAULT_ANALYZERS.filter((analyzer) => analyzer.id !== 'complexity'),
        ],
      },
    );

    expect(result.analyzers[0]).toMatchObject({
      id: 'complexity',
      findings: 0,
      error: 'parser crashed',
    });
    expect(result.findings.map((finding) => finding.rule)).toEqual(['debugger', 'analyzer-error']);
    expect(result.gate.status).toBe('passed');
  });

  it('deduplicates identical findings', () => {
    const twice: Analyzer = {
      id: 'todo-comments',
      description: 'twice',
      analyze: () => [
        {
          analyzer: 'todo-comments',
          rule: 'r',
          severity: 'info',
          message: 'm',
          path: 'a',
          line: 1,
        },
        {
          analyzer: 'todo-comments',
          rule: 'r',
          severity: 'info',
          message: 'm',
          path: 'a',
          line: 1,
        },
      ],
    };
    const result = runReview({ pullRequest: PULL_REQUEST, files: [] }, DEFAULT_CONFIG, {
      analyzers: [twice],
    });
    expect(result.findings).toHaveLength(1);
  });

  it('caps the findings, keeps the most serious and marks the review partial', () => {
    const lines = Array.from({ length: MAX_FINDINGS + 10 }, () => '// TODO later');
    const result = review(
      [changedFile('src/a.ts', [...lines, `const key = "${FAKE.awsKeyId}";`])],
      DEFAULT_CONFIG,
    );

    expect(result.findings).toHaveLength(MAX_FINDINGS);
    expect(result.findings[0]?.severity).toBe('blocker');
    expect(result.counts.info).toBe(MAX_FINDINGS + 10);
    expect(result.stats.partial).toBe(true);
  });

  it('reports a truncated file list as partial', () => {
    expect(review([], DEFAULT_CONFIG, { truncated: true }).stats.partial).toBe(true);
  });

  it('explains that a configuration change applies after the merge', () => {
    const result = review([changedFile('.codelens.yml', ['gate: {}'])]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        analyzer: 'codelens',
        rule: 'config-changed',
        severity: 'info',
        path: '.codelens.yml',
      }),
    ]);
  });

  it('measures the duration with the injected clock', () => {
    let tick = 0;
    const result = runReview({ pullRequest: PULL_REQUEST, files: [] }, DEFAULT_CONFIG, {
      now: () => (tick += 5),
    });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.analyzers.every((run) => run.durationMs === 5)).toBe(true);
  });

  it('stays fast on lines crafted to make regular expressions backtrack', () => {
    const hostile = [
      `password = "${'a'.repeat(990)}`,
      `query(\`SELECT ${'x'.repeat(990)}`,
      `// TODO ${'#'.repeat(990)}`,
      `"${'a'.repeat(400)}": "${'^'.repeat(500)}`,
      'x'.repeat(5000),
    ];
    const started = performance.now();
    review([
      changedFile(
        'src/hostile.ts',
        Array.from({ length: 200 }, (_, index) => hostile[index % hostile.length] ?? ''),
      ),
    ]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('filesNeedingContent', () => {
  it('lists the files whose content the enabled analyzers need', () => {
    const files = [
      changedFile('src/a.ts', ['x']),
      changedFile('src/a.spec.ts', ['x']),
      changedFile('README.md', ['x']),
      changedFile('src/gone.ts', ['x'], { status: 'removed' }),
      changedFile('src/untouched.ts', [], { patch: '@@ -1,1 +0,0 @@\n-x' }),
    ];
    expect(filesNeedingContent(files, DEFAULT_CONFIG)).toEqual(['src/a.ts']);

    const noComplexity = config({
      analyzers: { ...DEFAULT_CONFIG.analyzers, complexity: { enabled: false, threshold: 10 } },
    });
    expect(filesNeedingContent(files, noComplexity)).toEqual([]);
  });
});
