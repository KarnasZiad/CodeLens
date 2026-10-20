import { describe, expect, it } from 'vitest';
import { changedFile, FAKE, PULL_REQUEST } from '../../test/helpers.js';
import { DEFAULT_CONFIG, parseConfig } from '../config.js';
import { runReview } from '../engine.js';
import {
  escapeCell,
  renderConfigErrors,
  renderSummary,
  SUMMARY_MARKER,
  summaryTitle,
} from './markdown.js';

const fileUrl = (path: string, line?: number) =>
  `https://github.com/acme/shop/blob/abc123/${path}${line === undefined ? '' : `#L${line}`}`;

describe('renderSummary', () => {
  it('starts with the marker, states the verdict and links each finding', () => {
    const result = runReview(
      {
        pullRequest: PULL_REQUEST,
        files: [changedFile('src/cart.ts', ['debugger;', `const key = "${FAKE.awsKeyId}";`])],
      },
      DEFAULT_CONFIG,
      { now: () => 0 },
    );
    const markdown = renderSummary(result, { fileUrl });

    expect(markdown.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(markdown).toContain('### ❌ CodeLens : quality gate en échec');
    expect(markdown).toContain('| 🛑 Bloquant | 1 | 0 ❌ |');
    expect(markdown).toContain('| 🟠 Majeur | 1 | — |');
    expect(markdown).toContain(
      '[`src/cart.ts:2`](https://github.com/acme/shop/blob/abc123/src/cart.ts#L2)',
    );
    expect(markdown).toContain('<sub>1 fichier analysé sur 1 · +2 −0 · 8 analyseurs · 0,0 s</sub>');
    expect(markdown).not.toContain(FAKE.awsKeyId);
  });

  it('congratulates a clean pull request', () => {
    const result = runReview({ pullRequest: PULL_REQUEST, files: [] }, DEFAULT_CONFIG);
    const markdown = renderSummary(result);
    expect(markdown).toContain('### ✅ CodeLens : quality gate réussie');
    expect(markdown).toContain('Aucun constat sur les lignes modifiées.');
    expect(summaryTitle(result)).toBe('Quality gate réussie · aucun constat');
  });

  it('lists the most serious findings and counts the rest', () => {
    const result = runReview(
      {
        pullRequest: PULL_REQUEST,
        files: [
          // A test file: no missing-tests finding among the TODOs.
          changedFile(
            'src/a.spec.ts',
            Array.from({ length: 25 }, () => '// TODO later'),
          ),
        ],
      },
      DEFAULT_CONFIG,
    );
    const markdown = renderSummary(result, { maxListed: 20 });
    expect(markdown.match(/^\| ℹ️ \| /gm)).toHaveLength(20);
    expect(markdown).toContain('… et 5 autres constats');
    expect(summaryTitle(result)).toBe('Quality gate réussie · 25 constats');
  });

  it('flags partial reviews and failed analyzers', () => {
    const result = runReview(
      { pullRequest: PULL_REQUEST, files: [], truncated: true },
      DEFAULT_CONFIG,
      {
        analyzers: [
          {
            id: 'secrets',
            description: 'broken',
            analyze: () => {
              throw new Error('boom');
            },
          },
        ],
      },
    );
    const markdown = renderSummary(result);
    expect(markdown).toContain('Analyse partielle');
    expect(markdown).toContain('Analyseurs en échec : secrets.');
  });

  it('neutralizes crafted file names and refuses non-HTTPS links', () => {
    const result = runReview(
      {
        pullRequest: PULL_REQUEST,
        files: [changedFile('src/<img src=x>|](javascript:x).ts', ['debugger;'])],
      },
      DEFAULT_CONFIG,
    );
    const markdown = renderSummary(result, { fileUrl: () => 'javascript:alert(1)' });
    expect(markdown).not.toContain('<img');
    // Only escaped brackets remain, which render as text, never as a link.
    expect(markdown).not.toMatch(/(?<!\\)\]\(javascript:/);
    expect(markdown).toContain('&lt;img src=x&gt;\\|\\]');
  });
});

describe('escapeCell', () => {
  it('escapes table, link and HTML syntax and joins lines', () => {
    expect(escapeCell('a|b [c](d) <e>\\\nf')).toBe('a\\|b \\[c\\](d) &lt;e&gt;\\\\ f');
  });
});

describe('renderConfigErrors', () => {
  it('lists each error with its line and key', () => {
    const parsed = parseConfig('analyzers:\n  complexity:\n    threshold: 1\n');
    if (parsed.ok) throw new Error('expected an invalid configuration');
    const markdown = renderConfigErrors(parsed.errors);
    expect(markdown).toContain('configuration invalide');
    expect(markdown).toMatch(/\| 3 \| `analyzers\.complexity\.threshold` \| Trop petit/);
    expect(renderConfigErrors([{ path: '', message: 'YAML invalide : X' }])).toContain(
      '| — | — | YAML invalide : X |',
    );
  });
});
