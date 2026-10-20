import { describe, expect, it } from 'vitest';
import { addedBlocks, addedLines, parsePatch, removedLines } from './patch.js';

// Shape of the `patch` field returned by GET /repos/{owner}/{repo}/pulls/{number}/files.
const GITHUB_PATCH = [
  '@@ -10,5 +10,6 @@ export function total(items: Item[]) {',
  '   let sum = 0;',
  '-  for (const item of items) sum += item.price;',
  '+  for (const item of items) {',
  '+    sum += item.price * item.quantity;',
  '+  }',
  '   return sum;',
  ' }',
  '-',
  '@@ -40,3 +41,4 @@ export function vat(amount: number) {',
  '   return amount * 0.2;',
  ' }',
  '+export const VAT_RATE = 0.2;',
  ' ',
].join('\n');

describe('parsePatch', () => {
  it('numbers the lines of the base and head versions', () => {
    const [first, second] = parsePatch(GITHUB_PATCH);

    expect(first).toMatchObject({ oldStart: 10, oldLines: 5, newStart: 10, newLines: 6 });
    expect(first?.section).toBe('export function total(items: Item[]) {');
    expect(first?.lines[1]).toEqual({
      kind: 'removed',
      content: '  for (const item of items) sum += item.price;',
      oldLine: 11,
    });
    expect(first?.lines[2]).toEqual({
      kind: 'added',
      content: '  for (const item of items) {',
      newLine: 11,
    });
    expect(second?.lines[2]).toEqual({
      kind: 'added',
      content: 'export const VAT_RATE = 0.2;',
      newLine: 43,
    });
  });

  it('lists the added lines with their head line numbers', () => {
    expect(addedLines(parsePatch(GITHUB_PATCH)).map((line) => line.line)).toEqual([11, 12, 13, 43]);
    expect(removedLines(parsePatch(GITHUB_PATCH))).toEqual([
      '  for (const item of items) sum += item.price;',
      '',
    ]);
  });

  it('relies on the hunk counts, not on the line prefixes', () => {
    // A removed SQL comment starts with "--", an added line looks like a hunk header.
    const hunks = parsePatch(
      ['@@ -1,2 +1,2 @@', '--- old comment', '+@@ not a header @@', ' context'].join('\n'),
    );

    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines.map((line) => line.kind)).toEqual(['removed', 'added', 'context']);
    expect(hunks[0]?.lines[0]?.content).toBe('-- old comment');
  });

  it('handles single-line hunks, missing final newlines and file headers', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    ].join('\n');

    const [hunk] = parsePatch(patch);
    expect(hunk).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 });
    expect(hunk?.lines.map((line) => `${line.kind}:${line.content}`)).toEqual([
      'removed:old',
      'added:new',
    ]);
  });

  it('treats an empty line inside a hunk as an empty context line', () => {
    const [hunk] = parsePatch(['@@ -1,3 +1,3 @@', ' a', '', '+c', '-b'].join('\n'));
    expect(hunk?.lines[1]).toEqual({ kind: 'context', content: '', oldLine: 2, newLine: 2 });
  });

  it('returns nothing for an empty or binary patch', () => {
    expect(parsePatch('')).toEqual([]);
    expect(parsePatch('Binary files differ')).toEqual([]);
  });

  it('strips the carriage return of CRLF files from added lines', () => {
    expect(addedLines(parsePatch('@@ -0,0 +1 @@\n+const a = 1;\r'))).toEqual([
      { line: 1, content: 'const a = 1;' },
    ]);
  });
});

describe('addedBlocks', () => {
  it('groups consecutive added lines', () => {
    const blocks = addedBlocks([
      { line: 1, content: 'a' },
      { line: 2, content: 'b' },
      { line: 5, content: 'c' },
    ]);
    expect(blocks.map((block) => block.map((line) => line.content))).toEqual([['a', 'b'], ['c']]);
    expect(addedBlocks([])).toEqual([]);
  });
});
