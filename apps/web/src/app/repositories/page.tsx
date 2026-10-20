import type { Metadata } from 'next';
import Link from 'next/link';
import { GateStatusBadge } from '../../components/badges';
import { Shell } from '../../components/Shell';
import { load } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Me, Repository } from '../../lib/types';

export const metadata: Metadata = { title: 'Dépôts' };

export default async function RepositoriesPage() {
  const [me, { items }] = await Promise.all([
    load<Me>('/api/auth/me', '/repositories'),
    load<{ items: Repository[] }>('/api/repositories', '/repositories'),
  ]);

  return (
    <Shell me={me}>
      <h1 className="mb-4 text-xl font-semibold">Dépôts</h1>
      {items.length === 0 ? (
        <p className="card text-sm text-slate-600">
          Aucun dépôt visible. Installez l’application CodeLens sur un dépôt dont vous êtes membre :
          il apparaîtra ici après sa première pull request.
        </p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Dépôt</th>
                <th>PR ouvertes</th>
                <th>Dernière analyse</th>
                <th>Dernière gate</th>
              </tr>
            </thead>
            <tbody>
              {items.map((repository) => (
                <tr key={repository.id}>
                  <td>
                    <Link
                      href={`/repositories/${repository.fullName}`}
                      className="link font-medium"
                    >
                      {repository.fullName}
                    </Link>
                    {repository.private ? (
                      <span className="ml-2 text-xs text-slate-500">privé</span>
                    ) : null}
                  </td>
                  <td>{repository.openPullRequests}</td>
                  <td>{formatDateTime(repository.lastReviewAt)}</td>
                  <td>
                    <GateStatusBadge status={repository.lastGate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
