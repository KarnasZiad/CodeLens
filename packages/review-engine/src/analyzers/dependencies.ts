import { removedLines } from '../diff/patch.js';
import type { Finding } from '../model.js';
import { baseName, isLockfile } from '../paths.js';
import { type Analyzer, scannableLines } from './analyzer.js';

// "name": "version range" — values of scripts ("vitest run") or metadata do not look like ranges.
const DEPENDENCY_LINE =
  /^\s*"(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)"\s*:\s*"((?:[\^~<>=*]|\d|workspace:|npm:|catalog:|latest|next|github:|git\+|file:|link:)[^"]*)"/i;

// Same "name": "range" shape outside of dependency maps.
const NOT_DEPENDENCIES = new Set(['version', 'node', 'npm', 'pnpm', 'yarn', 'bun']);

function dependencyEntry(line: string): { name: string; range: string } | null {
  const match = DEPENDENCY_LINE.exec(line);
  const name = match?.[1];
  const range = match?.[2];
  if (!name || range === undefined || NOT_DEPENDENCIES.has(name)) return null;
  return { name, range };
}

/**
 * New npm dependencies, and manifests changed without their lockfile. Works on the diff alone:
 * an entry added without a removed entry of the same name is a new dependency, not an upgrade.
 */
export const dependenciesAnalyzer: Analyzer = {
  id: 'dependencies',
  description: 'Dépendances ajoutées et lockfile',
  analyze(context) {
    const findings: Finding[] = [];
    const lockfileChanged = context.files.some((file) => isLockfile(file.path));
    let manifestChanged = false;

    for (const file of context.files) {
      if (baseName(file.path) !== 'package.json') continue;
      const removed = new Set(
        removedLines(file.hunks)
          .map(dependencyEntry)
          .filter((entry) => entry !== null)
          .map((entry) => entry.name),
      );
      if (removed.size > 0) manifestChanged = true;

      for (const { line, content } of scannableLines(file)) {
        const entry = dependencyEntry(content);
        if (!entry) continue;
        manifestChanged = true;
        if (removed.has(entry.name)) continue;
        findings.push({
          analyzer: 'dependencies',
          rule: 'new-dependency',
          severity: 'info',
          message: `Nouvelle dépendance « ${entry.name} » (${entry.range}) : vérifiez sa maintenance, sa licence, son poids et qu’aucune dépendance existante ne fait déjà le travail.`,
          path: file.path,
          line,
        });
      }
    }

    if (manifestChanged && !lockfileChanged) {
      findings.push({
        analyzer: 'dependencies',
        rule: 'lockfile-not-updated',
        severity: 'major',
        message:
          'Dépendances modifiées dans package.json sans mise à jour du lockfile : la CI et la production installeront d’autres versions que celles testées en local.',
      });
    }
    return findings;
  },
};
