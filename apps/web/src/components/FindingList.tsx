import { blobUrl, groupByFile } from '../lib/format';
import type { RunDetail } from '../lib/types';
import { SeverityBadge } from './badges';

/** Findings of a review, file by file, each line linked to the reviewed commit on GitHub. */
export function FindingList({ run, webUrl }: { run: RunDetail; webUrl: string }) {
  if (run.findings.length === 0) {
    return <p className="card text-sm text-slate-600">Aucun constat sur les lignes modifiées.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {groupByFile(run.findings).map((group) => (
        <section key={group.path ?? 'pull-request'} className="card p-0">
          <h3 className="border-b border-slate-200 px-4 py-2 font-mono text-sm">
            {group.path ?? 'Pull request'}
          </h3>
          <ul className="divide-y divide-slate-100">
            {group.findings.map((finding, index) => (
              <li
                key={`${finding.rule}-${finding.line ?? 'pr'}-${index}`}
                className="flex gap-3 px-4 py-3 text-sm"
              >
                <div className="w-24 shrink-0">
                  <SeverityBadge severity={finding.severity} />
                </div>
                <div className="min-w-0 flex-1">
                  <p>{finding.message}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {finding.analyzer}/{finding.rule}
                    {group.path !== null && finding.line !== null ? (
                      <>
                        {' · '}
                        <a
                          href={blobUrl(
                            webUrl,
                            run.repository.fullName,
                            run.headSha,
                            group.path,
                            finding.line,
                          )}
                          className="link"
                          rel="noreferrer"
                          target="_blank"
                        >
                          ligne {finding.line}
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
