import type { Metadata } from 'next';
import Link from 'next/link';
import { GateBadge, SeverityBadge } from '../../../components/badges';
import { FindingList } from '../../../components/FindingList';
import { Shell } from '../../../components/Shell';
import { load } from '../../../lib/api';
import { formatDateTime, formatDuration, shortSha } from '../../../lib/format';
import { type Me, type RunDetail, SEVERITIES } from '../../../lib/types';

const GITHUB_WEB_URL = process.env.GITHUB_WEB_URL ?? 'https://github.com';

export const metadata: Metadata = { title: 'Analyse' };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/runs/${id}`;
  const [me, run] = await Promise.all([
    load<Me>('/api/auth/me', here),
    load<RunDetail>(`/api/runs/${encodeURIComponent(id)}`, here),
  ]);

  return (
    <Shell me={me}>
      <nav aria-label="Fil d’Ariane" className="mb-2 text-sm">
        <Link href={`/repositories/${run.repository.fullName}`} className="link">
          {run.repository.fullName}
        </Link>
      </nav>
      <h1 className="mb-1 text-xl font-semibold">
        <span className="text-slate-500">#{run.pullRequest.number}</span> {run.pullRequest.title}
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        par {run.pullRequest.author} · commit <code>{shortSha(run.headSha)}</code> · analysée le{' '}
        {formatDateTime(run.completedAt ?? run.queuedAt)} en {formatDuration(run.durationMs)}
      </p>

      <section className="card mb-6 flex flex-wrap items-center gap-4">
        <GateBadge run={run} />
        <ul className="flex flex-wrap gap-3 text-sm" aria-label="Constats par sévérité">
          {SEVERITIES.map((severity) => (
            <li key={severity} className="flex items-center gap-1">
              <SeverityBadge severity={severity} /> {run.counts[severity] ?? 0}
            </li>
          ))}
        </ul>
        {run.partial ? (
          <p className="text-sm text-amber-700">
            Analyse partielle : la PR dépasse les limites d’analyse.
          </p>
        ) : null}
      </section>

      <FindingList run={run} webUrl={GITHUB_WEB_URL} />
    </Shell>
  );
}
