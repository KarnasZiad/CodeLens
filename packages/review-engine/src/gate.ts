import type { CodeLensConfig } from './config.js';
import { type Finding, type Severity, SEVERITIES } from './model.js';

export interface GateCondition {
  severity: Severity;
  max: number;
  actual: number;
  passed: boolean;
}

export interface GateResult {
  status: 'passed' | 'failed';
  /** One condition per limited severity, from the most serious. */
  conditions: GateCondition[];
}

export type SeverityCounts = Record<Severity, number>;

export function countBySeverity(findings: readonly Finding[]): SeverityCounts {
  const counts: SeverityCounts = { info: 0, minor: 0, major: 0, critical: 0, blocker: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** The pull request passes when no severity goes over its maximum; unset maximums never fail. */
export function evaluateGate(
  findings: readonly Finding[],
  gate: CodeLensConfig['gate'],
): GateResult {
  const counts = countBySeverity(findings);
  const conditions: GateCondition[] = [];
  for (const severity of [...SEVERITIES].reverse()) {
    const max = gate.maxFindings[severity];
    if (max === null) continue;
    conditions.push({ severity, max, actual: counts[severity], passed: counts[severity] <= max });
  }
  return {
    status: conditions.every((condition) => condition.passed) ? 'passed' : 'failed',
    conditions,
  };
}
