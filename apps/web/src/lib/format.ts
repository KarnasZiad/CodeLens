import { type Finding, type RunSummary, type Severity, SEVERITIES } from './types';

export const SEVERITY_LABELS: Record<Severity, string> = {
  blocker: 'Bloquant',
  critical: 'Critique',
  major: 'Majeur',
  minor: 'Mineur',
  info: 'Info',
};

const dateTime = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Casablanca',
});

export function formatDateTime(iso: string | null): string {
  return iso === null ? '—' : dateTime.format(new Date(iso));
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** "2 bloquants, 1 majeur" — the most serious first, zeros left out. */
export function describeCounts(counts: RunSummary['counts']): string {
  const parts = SEVERITIES.flatMap((severity) => {
    const count = counts[severity] ?? 0;
    if (count === 0) return [];
    const label = SEVERITY_LABELS[severity].toLowerCase();
    return [`${count} ${label}${count > 1 && severity !== 'info' ? 's' : ''}`];
  });
  return parts.length === 0 ? 'aucun constat' : parts.join(', ');
}

export interface FileFindings {
  path: string | null;
  findings: Finding[];
}

/** Findings grouped by file, in the order the API sorted them (most serious first). */
export function groupByFile(findings: readonly Finding[]): FileFindings[] {
  const groups = new Map<string | null, Finding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.path);
    if (group) group.push(finding);
    else groups.set(finding.path, [finding]);
  }
  return [...groups].map(([path, items]) => ({ path, findings: items }));
}

/** Share of reviews whose gate passed, as a rounded percentage; null without any review. */
export function passRate(gate: { passed: number; failed: number }): number | null {
  const total = gate.passed + gate.failed;
  return total === 0 ? null : Math.round((gate.passed / total) * 100);
}

/** Link to a line of a file at the reviewed commit; paths come from the API, never trusted raw. */
export function blobUrl(
  webUrl: string,
  fullName: string,
  sha: string,
  path: string,
  line: number | null,
): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${webUrl}/${fullName}/blob/${sha}/${encoded}${line === null ? '' : `#L${line}`}`;
}
