import { SEVERITY_LABELS } from '../lib/format';
import type { GateStatus, RunSummary, Severity } from '../lib/types';

const SEVERITY_STYLES: Record<Severity, string> = {
  blocker: 'bg-red-700 text-white',
  critical: 'bg-red-100 text-red-800',
  major: 'bg-orange-100 text-orange-800',
  minor: 'bg-yellow-100 text-yellow-800',
  info: 'bg-slate-100 text-slate-700',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${SEVERITY_STYLES[severity]}`}>{SEVERITY_LABELS[severity]}</span>;
}

/** Verdict of a review: the gate when it ran, otherwise the state of the run. */
export function GateBadge({
  run,
}: {
  run: Pick<RunSummary, 'status' | 'gateStatus' | 'conclusion'> | null;
}) {
  if (run === null)
    return <span className="badge bg-slate-100 text-slate-500">Jamais analysée</span>;
  if (run.status === 'queued' || run.status === 'running') {
    return <span className="badge bg-sky-100 text-sky-800">Analyse en cours</span>;
  }
  if (run.status === 'failed')
    return <span className="badge bg-slate-200 text-slate-700">Analyse impossible</span>;
  if (run.gateStatus === null)
    return <span className="badge bg-slate-200 text-slate-700">Configuration invalide</span>;
  return <GateStatusBadge status={run.gateStatus} />;
}

export function GateStatusBadge({ status }: { status: GateStatus | null }) {
  if (status === null) return <span className="text-slate-400">—</span>;
  return status === 'passed' ? (
    <span className="badge bg-emerald-100 text-emerald-800">Gate réussie</span>
  ) : (
    <span className="badge bg-red-100 text-red-800">Gate en échec</span>
  );
}
