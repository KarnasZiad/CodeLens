import type { Finding } from '../model.js';
import { isLockfile } from '../paths.js';
import { type Analyzer, scannableLines } from './analyzer.js';

/** Pull requests that are too big to be reviewed seriously. Lockfiles are not counted. */
export const prSizeAnalyzer: Analyzer = {
  id: 'pr-size',
  description: 'Taille de la pull request',
  analyze(context) {
    const { warnAt, failAt } = context.config.analyzers['pr-size'];
    const changed = context.files
      .filter((file) => !isLockfile(file.path))
      .reduce((total, file) => total + file.additions + file.deletions, 0);
    if (changed <= warnAt) return [];
    const over = changed > failAt;
    return [
      {
        analyzer: 'pr-size',
        rule: 'pull-request-size',
        severity: over ? 'major' : 'minor',
        message: `${changed} lignes modifiées (seuil : ${over ? failAt : warnAt}). Une PR plus petite est relue plus vite et plus sérieusement : découpez-la si possible.`,
      },
    ];
  },
};

/** Source changes that come without any test change. */
export const missingTestsAnalyzer: Analyzer = {
  id: 'missing-tests',
  description: 'Code modifié sans test',
  analyze(context) {
    const { minChangedLines } = context.config.analyzers['missing-tests'];
    if (context.files.some((file) => file.isTest)) return [];
    const sources = context.files.filter(
      (file) =>
        file.language !== null &&
        file.status !== 'removed' &&
        !/\.config\.[cm]?[jt]s$/.test(file.path),
    );
    const added = sources.reduce((total, file) => total + file.additions, 0);
    if (added < minChangedLines) return [];
    const examples = sources
      .slice(0, 3)
      // Backticks are stripped: a crafted file name must not close the code span.
      .map((file) => `\`${file.path.replace(/`/g, '')}\``)
      .join(', ');
    return [
      {
        analyzer: 'missing-tests',
        rule: 'no-test-change',
        severity: 'minor',
        message: `${added} lignes de code ajoutées (${examples}${sources.length > 3 ? '…' : ''}) sans aucun test modifié. Ajoutez un test qui couvre le changement, ou expliquez pourquoi dans la description.`,
      },
    ];
  },
};

const TODO = /(?:\/\/|#|\/\*|\*|<!--)\s*(TODO|FIXME|HACK|XXX)\b/;
// Accepted references: #123, ABC-123, or a link to the tracker.
const TICKET = /#\d+|\b[A-Z][A-Z0-9]+-\d+\b|https?:\/\//;

/** New TODO comments without a ticket: they are rarely done once merged. */
export const todoCommentsAnalyzer: Analyzer = {
  id: 'todo-comments',
  description: 'TODO et FIXME sans ticket',
  analyze(context) {
    const findings: Finding[] = [];
    for (const file of context.files) {
      if (file.language === null) continue;
      for (const { line, content } of scannableLines(file)) {
        const marker = TODO.exec(content);
        if (!marker || TICKET.test(content)) continue;
        findings.push({
          analyzer: 'todo-comments',
          rule: 'todo-without-ticket',
          severity: 'info',
          message: `${marker[1] ?? 'TODO'} sans référence de ticket : créez le ticket et citez-le (#123 ou ABC-123), sinon il sera oublié.`,
          path: file.path,
          line,
        });
      }
    }
    return findings;
  },
};
