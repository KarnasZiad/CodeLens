import type { Metadata } from 'next';
import Link from 'next/link';
import { GateBadge } from '../../../../components/badges';
import { Shell } from '../../../../components/Shell';
import { TrendChart } from '../../../../components/TrendChart';
import { load } from '../../../../lib/api';
import { describeCounts, formatDateTime, passRate } from '../../../../lib/format';
import type { Me, PullRequest, Trends } from '../../../../lib/types';

interface Props {
  params: Promise<{ owner: string; name: string }>;
  searchParams: Promise<{ state?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, name } = await params;
  return { title: `${owner}/${name}` };
}

export default async function RepositoryPage({ params, searchParams }: Props) {
  const { owner, name } = await params;
  const state = (await searchParams).state === 'all' ? 'all' : 'open';
  const base = `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const here = `/repositories/${owner}/${name}`;
  const [me, pulls, trends] = await Promise.all([
    load<Me>('/api/auth/me', here),
    load<{ repository: { fullName: string }; items: PullRequest[] }>(
      `${base}/pulls?state=${state}`,
      here,
    ),
    load<Trends>(`${base}/trends?days=30`, here),
  ]);
  const rate = passRate(trends.gate);

  return (
    <Shell me={me}>
      <h1 className="mb-1 text-xl font-semibold">{pulls.repository.fullName}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {rate === null
          ? 'Aucune analyse terminée sur les 30 derniers jours.'
          : `${rate} % de gates réussies sur 30 jours (${trends.gate.passed} sur ${trends.gate.passed + trends.gate.failed}).`}
      </p>

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-4">
          <h2 className="font-semibold">Pull requests</h2>
          <nav aria-label="Filtre" className="flex gap-2 text-sm">
            <Link
              href={here}
              aria-current={state === 'open' ? 'page' : undefined}
              className={state === 'open' ? 'font-semibold' : 'link'}
            >
              Ouvertes
            </Link>
            <Link
              href={`${here}?state=all`}
              aria-current={state === 'all' ? 'page' : undefined}
              className={state === 'all' ? 'font-semibold' : 'link'}
            >
              Toutes
            </Link>
          </nav>
        </div>
        {pulls.items.length === 0 ? (
          <p className="card text-sm text-slate-600">Aucune pull request.</p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Auteur</th>
                  <th>Mise à jour</th>
                  <th>Dernière analyse</th>
                </tr>
              </thead>
              <tbody>
                {pulls.items.map((pull) => (
                  <tr key={pull.number}>
                    <td>
                      <span className="text-slate-500">#{pull.number}</span> {pull.title}
                      {pull.draft ? (
                        <span className="ml-2 text-xs text-slate-500">brouillon</span>
                      ) : null}
                      {pull.state !== 'open' ? (
                        <span className="ml-2 text-xs text-slate-500">
                          {pull.state === 'merged' ? 'fusionnée' : 'fermée'}
                        </span>
                      ) : null}
                    </td>
                    <td>{pull.author}</td>
                    <td>{formatDateTime(pull.updatedAt)}</td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <GateBadge run={pull.latestRun} />
                        {pull.latestRun ? (
                          <Link href={`/runs/${pull.latestRun.id}`} className="link text-xs">
                            {describeCounts(pull.latestRun.counts)}
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Constats par semaine</h2>
        <div className="card">
          <TrendChart trends={trends} />
        </div>
      </section>
    </Shell>
  );
}
