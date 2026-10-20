import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config.js';
import { countBySeverity, evaluateGate } from './gate.js';
import type { Finding, Severity } from './model.js';

const finding = (severity: Severity): Finding => ({
  analyzer: 'x',
  rule: 'y',
  severity,
  message: 'm',
});

describe('evaluateGate', () => {
  it('passes by default unless there is a blocker or a critical finding', () => {
    const minorOnly = Array.from({ length: 50 }, () => finding('major'));
    expect(evaluateGate(minorOnly, DEFAULT_CONFIG.gate)).toEqual({
      status: 'passed',
      conditions: [
        { severity: 'blocker', max: 0, actual: 0, passed: true },
        { severity: 'critical', max: 0, actual: 0, passed: true },
      ],
    });
    expect(evaluateGate([finding('critical')], DEFAULT_CONFIG.gate).status).toBe('failed');
  });

  it('applies custom limits and lifts null ones', () => {
    const gate = { maxFindings: { blocker: 0, critical: null, major: 2, minor: null, info: null } };
    const findings = [finding('critical'), finding('major'), finding('major'), finding('major')];

    const result = evaluateGate(findings, gate);
    expect(result.status).toBe('failed');
    expect(result.conditions).toEqual([
      { severity: 'blocker', max: 0, actual: 0, passed: true },
      { severity: 'major', max: 2, actual: 3, passed: false },
    ]);
  });
});

describe('countBySeverity', () => {
  it('counts every severity, zero included', () => {
    expect(countBySeverity([finding('info'), finding('info'), finding('blocker')])).toEqual({
      info: 2,
      minor: 0,
      major: 0,
      critical: 0,
      blocker: 1,
    });
  });
});
