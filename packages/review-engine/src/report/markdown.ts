import type { ConfigError } from '../config.js';
import type { ReviewResult } from '../engine.js';
import { type Finding, type Severity, SEVERITIES, SEVERITY_LABELS } from '../model.js';

/** Hidden marker that identifies the summary comment, so that each push updates it in place. */
export const SUMMARY_MARKER = '<!-- codelens:summary -->';

export const SEVERITY_ICONS: Record<Severity, string> = {
  info: 'ℹ️',
  minor: '🟡',
  major: '🟠',
  critical: '🔴',
  blocker: '🛑',
};

export interface SummaryOptions {
  /** Link to a line of a file at the analyzed commit; locations are not linked without it. */
  fileUrl?: (path: string, line?: number) => string;
  /** Findings listed in the comment; all of them are annotated on the check anyway. */
  maxListed?: number;
}

/**
 * Escapes text from the pull request (paths, names) for a Markdown table cell: no HTML, no table
 * break, no line break, no link syntax.
 */
export function escapeCell(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** One-line title of the check run. */
export function summaryTitle(result: ReviewResult): string {
  const total = SEVERITIES.reduce((sum, severity) => sum + result.counts[severity], 0);
  const findings = total === 0 ? 'aucun constat' : `${total} constat${total > 1 ? 's' : ''}`;
  return result.gate.status === 'passed'
    ? `Quality gate réussie · ${findings}`
    : `Quality gate en échec · ${findings}`;
}

function location(finding: Finding, options: SummaryOptions): string {
  if (finding.path === undefined) return 'PR';
  const text = `\`${finding.path.replace(/`/g, '')}${finding.line === undefined ? '' : `:${finding.line}`}\``;
  const url = options.fileUrl?.(finding.path, finding.line);
  return url?.startsWith('https://') ? `[${escapeCell(text)}](${url})` : escapeCell(text);
}

/** The pull request comment: verdict, counts against the limits, most serious findings. */
export function renderSummary(result: ReviewResult, options: SummaryOptions = {}): string {
  const maxListed = options.maxListed ?? 20;
  const passed = result.gate.status === 'passed';
  const lines: string[] = [
    SUMMARY_MARKER,
    `### ${passed ? '✅' : '❌'} CodeLens : quality gate ${passed ? 'réussie' : 'en échec'}`,
    '',
    '| Sévérité | Constats | Maximum |',
    '| --- | ---: | ---: |',
  ];

  for (const severity of [...SEVERITIES].reverse()) {
    const condition = result.gate.conditions.find((item) => item.severity === severity);
    const max = condition ? `${condition.max}${condition.passed ? '' : ' ❌'}` : '—';
    lines.push(
      `| ${SEVERITY_ICONS[severity]} ${SEVERITY_LABELS[severity]} | ${result.counts[severity]} | ${max} |`,
    );
  }

  if (result.findings.length > 0) {
    lines.push(
      '',
      '**Constats principaux**',
      '',
      '| | Emplacement | Constat |',
      '| --- | --- | --- |',
    );
    for (const finding of result.findings.slice(0, maxListed)) {
      lines.push(
        `| ${SEVERITY_ICONS[finding.severity]} | ${location(finding, options)} | ${escapeCell(finding.message)} |`,
      );
    }
    const total = SEVERITIES.reduce((sum, severity) => sum + result.counts[severity], 0);
    if (total > maxListed) {
      lines.push(
        '',
        `_… et ${total - maxListed} autres constats, annotés dans le check « CodeLens »._`,
      );
    }
  } else {
    lines.push('', 'Aucun constat sur les lignes modifiées. 👏');
  }

  if (result.stats.partial) {
    lines.push(
      '',
      '> ⚠️ Analyse partielle : la PR dépasse les limites d’analyse (nombre de fichiers ou de constats). Découpez-la pour une analyse complète.',
    );
  }

  const failed = result.analyzers.filter((run) => run.error !== undefined);
  if (failed.length > 0) {
    lines.push('', `> ⚠️ Analyseurs en échec : ${failed.map((run) => run.id).join(', ')}.`);
  }

  const { stats } = result;
  lines.push(
    '',
    `<sub>${stats.analyzedFiles} fichier${stats.analyzedFiles > 1 ? 's' : ''} analysé${stats.analyzedFiles > 1 ? 's' : ''} sur ${stats.files} · +${stats.additions} −${stats.deletions} · ${result.analyzers.length} analyseurs · ${seconds(result.durationMs)}</sub>`,
  );
  return lines.join('\n');
}

/** Explains an invalid `.codelens.yml`, error by error. */
export function renderConfigErrors(errors: readonly ConfigError[]): string {
  return [
    '### ⚠️ CodeLens : configuration invalide',
    '',
    'Le fichier `.codelens.yml` de la branche de base est invalide ; aucune analyse n’a été faite.',
    '',
    '| Ligne | Clé | Erreur |',
    '| ---: | --- | --- |',
    ...errors.map(
      (error) =>
        `| ${error.line ?? '—'} | ${error.path === '' ? '—' : `\`${escapeCell(error.path.replace(/`/g, ''))}\``} | ${escapeCell(error.message)} |`,
    ),
  ].join('\n');
}
