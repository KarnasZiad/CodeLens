import type { Finding } from '@codelens/review-engine';
import { describe, expect, it } from 'vitest';
import { inBatches, toAnnotations } from './annotations.js';

const finding = (overrides: Partial<Finding>): Finding => ({
  analyzer: 'secrets',
  rule: 'github-token',
  severity: 'blocker',
  message: 'Jeton GitHub détecté.',
  path: 'src/a.ts',
  line: 3,
  ...overrides,
});

describe('toAnnotations', () => {
  it('maps severities to annotation levels and keeps line ranges', () => {
    const annotations = toAnnotations([
      finding({}),
      finding({
        severity: 'major',
        analyzer: 'complexity',
        rule: 'cyclomatic-complexity',
        line: 10,
        endLine: 40,
      }),
      finding({ severity: 'info', line: undefined }),
      finding({ severity: 'minor', path: undefined }),
    ]);
    expect(annotations).toEqual([
      {
        path: 'src/a.ts',
        start_line: 3,
        end_line: 3,
        annotation_level: 'failure',
        title: 'Bloquant · secrets/github-token',
        message: 'Jeton GitHub détecté.',
      },
      expect.objectContaining({ annotation_level: 'warning', start_line: 10, end_line: 40 }),
      expect.objectContaining({ annotation_level: 'notice', start_line: 1, end_line: 1 }),
    ]);
  });

  it('keeps the first findings up to the limit', () => {
    const many = Array.from({ length: 10 }, (_, index) => finding({ line: index + 1 }));
    expect(toAnnotations(many, 4).map((annotation) => annotation.start_line)).toEqual([1, 2, 3, 4]);
  });
});

describe('inBatches', () => {
  it('splits into batches of at most 50', () => {
    expect(
      inBatches(Array.from({ length: 120 }, (_, index) => index)).map((batch) => batch.length),
    ).toEqual([50, 50, 20]);
    expect(inBatches([])).toEqual([]);
  });
});
