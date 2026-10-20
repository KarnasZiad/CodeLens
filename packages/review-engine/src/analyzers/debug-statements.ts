import type { Finding } from '../model.js';
import { globMatcher, isScript } from '../paths.js';
import { type Analyzer, isCommentLine, scannableLines } from './analyzer.js';

const DEBUGGER = /^\s*debugger\s*;?\s*(?:\/\/.*)?$/;
const CONSOLE = /\bconsole\.(?:log|debug|trace|dir|table)\s*\(/;
const FOCUSED_TEST = /\b(?:(?:describe|it|test|context|suite)\.only|fdescribe|fit)\s*\(/;
const PYTHON_BREAKPOINT = /\b(?:breakpoint\(\)|pdb\.set_trace\(\)|ipdb\.set_trace\(\))/;

/** Leftovers of a debugging session, and focused tests that silently skip the rest of a suite. */
export const debugStatementsAnalyzer: Analyzer = {
  id: 'debug-statements',
  description: 'Instructions de débogage et tests focalisés',
  analyze(context) {
    const options = context.config.analyzers['debug-statements'];
    const consoleAllowed = globMatcher(options.allowConsoleIn);
    const findings: Finding[] = [];

    for (const file of context.files) {
      const script = isScript(file.language);
      if (!script && file.language !== 'python') continue;

      for (const { line, content } of scannableLines(file)) {
        if (isCommentLine(content)) continue;
        const at = { path: file.path, line };

        if (script && FOCUSED_TEST.test(content)) {
          findings.push({
            analyzer: 'debug-statements',
            rule: 'focused-test',
            severity: 'critical',
            message:
              'Test focalisé (`.only`) : les autres tests du fichier ne s’exécutent plus, en local comme en CI.',
            ...at,
          });
        } else if (script && DEBUGGER.test(content)) {
          findings.push({
            analyzer: 'debug-statements',
            rule: 'debugger',
            severity: 'major',
            message:
              'Instruction `debugger` oubliée : elle met l’application en pause dès que les outils de développement sont ouverts.',
            ...at,
          });
        } else if (script && !file.isTest && !consoleAllowed(file.path) && CONSOLE.test(content)) {
          findings.push({
            analyzer: 'debug-statements',
            rule: 'console',
            severity: 'minor',
            message:
              'Sortie console de débogage : utilisez le logger de l’application, ou retirez-la.',
            ...at,
          });
        } else if (file.language === 'python' && PYTHON_BREAKPOINT.test(content)) {
          findings.push({
            analyzer: 'debug-statements',
            rule: 'breakpoint',
            severity: 'major',
            message: 'Point d’arrêt Python oublié : le processus attend une saisie et se bloque.',
            ...at,
          });
        }
      }
    }
    return findings;
  },
};
