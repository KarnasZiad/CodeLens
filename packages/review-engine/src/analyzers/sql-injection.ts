import { addedBlocks, type AddedLine } from '../diff/patch.js';
import type { Finding } from '../model.js';
import { isScript } from '../paths.js';
import { type Analyzer, scannableLines } from './analyzer.js';

/** Upper bound of a block of consecutive added lines matched at once. */
const MAX_BLOCK_LENGTH = 20_000;

// No \b before `$`: there is no word boundary between `.` and `$`.
const CALL = String.raw`(?:\b(?:query|execute|raw|unsafe)|\$(?:queryRawUnsafe|executeRawUnsafe))\s*\(\s*`;
const SQL = String.raw`(?:SELECT|INSERT|UPDATE|DELETE|WITH|MERGE|UPSERT|REPLACE)\b`;
// Up to the closing quote of the same kind: the other kind may appear inside the string.
const QUOTED = String.raw`(['"])\s*${SQL}(?:(?!\1).)*\1`;

// A template literal passed as an argument: tagged templates (sql`...`, $queryRaw`...`) are
// parameterized by their tag and never match, since they are not preceded by a parenthesis.
const JS_PATTERNS = [
  new RegExp(String.raw`${CALL}\x60\s*${SQL}[^\x60]*?\$\{`, 'gi'),
  new RegExp(String.raw`${CALL}${QUOTED}\s*\+`, 'gi'),
];

const PYTHON_PATTERNS = [
  new RegExp(String.raw`\bexecute(?:many)?\s*\(\s*f(['"])\s*${SQL}(?:(?!\1).)*?\{`, 'gi'),
  new RegExp(String.raw`\bexecute(?:many)?\s*\(\s*${QUOTED}\s*(?:%|\.format\()`, 'gi'),
];

const MESSAGE =
  'Requête SQL construite par interpolation : une valeur venue de l’utilisateur peut en modifier le sens. Passez les valeurs en paramètres liés ($1, ?, :nom) ou utilisez une template taguée (sql`...`).';

function matchBlock(block: AddedLine[], patterns: readonly RegExp[]): number[] {
  const text = block.map((line) => line.content).join('\n');
  if (text.length > MAX_BLOCK_LENGTH) return [];
  const lines = new Set<number>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const lineIndex = text.slice(0, match.index).split('\n').length - 1;
      const line = block[lineIndex]?.line;
      if (line !== undefined) lines.add(line);
    }
  }
  return [...lines];
}

/**
 * Heuristic detection of SQL built by string interpolation. Without data-flow analysis it cannot
 * tell a constant from user input, so it flags the construct, which is risky in any case.
 */
export const sqlInjectionAnalyzer: Analyzer = {
  id: 'sql-injection',
  description: 'Requêtes SQL construites par interpolation',
  analyze(context) {
    const findings: Finding[] = [];
    for (const file of context.files) {
      const patterns = isScript(file.language)
        ? JS_PATTERNS
        : file.language === 'python'
          ? PYTHON_PATTERNS
          : null;
      if (!patterns) continue;

      for (const block of addedBlocks(scannableLines(file))) {
        for (const line of matchBlock(block, patterns)) {
          findings.push({
            analyzer: 'sql-injection',
            rule: 'string-built-query',
            severity: 'critical',
            message: MESSAGE,
            path: file.path,
            line,
          });
        }
      }
    }
    return findings;
  },
};
