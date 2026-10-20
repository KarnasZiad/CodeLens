import { type Finding, type Severity, SEVERITY_LABELS } from '@codelens/review-engine';
import type { Annotation } from './git-provider.js';

/** GitHub accepts at most 50 annotations per request. */
export const ANNOTATIONS_PER_REQUEST = 50;
/** Annotations published per review; findings arrive sorted, so the most serious are kept. */
export const MAX_ANNOTATIONS = 200;

const LEVELS: Record<Severity, Annotation['annotation_level']> = {
  blocker: 'failure',
  critical: 'failure',
  major: 'warning',
  minor: 'warning',
  info: 'notice',
};

/** Findings located on a line become annotations; findings about the whole PR stay in the summary. */
export function toAnnotations(findings: readonly Finding[], max = MAX_ANNOTATIONS): Annotation[] {
  return findings
    .filter((finding): finding is Finding & { path: string } => finding.path !== undefined)
    .slice(0, max)
    .map((finding) => {
      const start = finding.line ?? 1;
      return {
        path: finding.path,
        start_line: start,
        end_line: Math.max(start, finding.endLine ?? start),
        annotation_level: LEVELS[finding.severity],
        title: `${SEVERITY_LABELS[finding.severity]} · ${finding.analyzer}/${finding.rule}`,
        message: finding.message,
      };
    });
}

export function inBatches<T>(items: readonly T[], size = ANNOTATIONS_PER_REQUEST): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
