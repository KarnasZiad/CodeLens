import type { Trends } from '../lib/types';

const WIDTH = 560;
const BAR_HEIGHT = 18;
const LABEL_WIDTH = 96;
const GAP = 10;

/**
 * Findings per week, one bar each, split by analyzer. Pure SVG: sizes are attributes, not inline
 * styles, so the strict CSP of the dashboard needs no exception.
 */
export function TrendChart({ trends }: { trends: Trends }) {
  const weeks = [...new Set(trends.weekly.map((entry) => entry.week))].sort();
  if (weeks.length === 0) {
    return (
      <p className="text-sm text-slate-500">Aucun constat sur les {trends.days} derniers jours.</p>
    );
  }
  const analyzers = [...new Set(trends.weekly.map((entry) => entry.analyzer))].sort();
  const totals = weeks.map((week) =>
    trends.weekly
      .filter((entry) => entry.week === week)
      .reduce((sum, entry) => sum + entry.findings, 0),
  );
  const max = Math.max(...totals);
  const scale = (WIDTH - LABEL_WIDTH - 40) / max;
  const height = weeks.length * (BAR_HEIGHT + GAP);

  return (
    <figure>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={`Constats par semaine sur ${trends.days} jours`}
        className="w-full max-w-2xl"
      >
        {weeks.map((week, row) => {
          let x = LABEL_WIDTH;
          const y = row * (BAR_HEIGHT + GAP);
          return (
            <g key={week}>
              <text x={0} y={y + BAR_HEIGHT - 4} className="fill-slate-500 text-[11px]">
                {`Sem. ${week.slice(5).replace('-', '/')}`}
              </text>
              {analyzers.map((analyzer) => {
                const findings =
                  trends.weekly.find((entry) => entry.week === week && entry.analyzer === analyzer)
                    ?.findings ?? 0;
                if (findings === 0) return null;
                const width = findings * scale;
                const rect = (
                  <rect
                    key={analyzer}
                    x={x}
                    y={y}
                    width={width}
                    height={BAR_HEIGHT}
                    className={`trend-${analyzers.indexOf(analyzer) % 6}`}
                  >
                    <title>{`${analyzer} : ${findings}`}</title>
                  </rect>
                );
                x += width;
                return rect;
              })}
              <text x={x + 6} y={y + BAR_HEIGHT - 4} className="fill-slate-700 text-[11px]">
                {totals[row]}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
        {analyzers.map((analyzer, index) => (
          <span key={analyzer} className="inline-flex items-center gap-1">
            <svg width="10" height="10" aria-hidden="true">
              <rect width="10" height="10" className={`trend-${index % 6}`} />
            </svg>
            {analyzer}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
