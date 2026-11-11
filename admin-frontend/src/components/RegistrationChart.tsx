import React, { useState } from 'react';
import { Dropdown } from './Dropdown';

interface RegistrationDay { date: string; registrations: number }
interface RegistrationChartProps {
  days: RegistrationDay[];
  today?: number;
  loading: boolean;
  error: boolean;
  refreshing: boolean;
  onRetry: () => void;
}

const dateLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const RegistrationChart: React.FC<RegistrationChartProps> = ({ days, today, loading, error, refreshing, onRetry }) => {
  const [grouping, setGrouping] = useState('week');
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const total = sorted.reduce((sum, day) => sum + day.registrations, 0);
  const recent = sorted.slice(-7).reduce((sum, day) => sum + day.registrations, 0);
  const previous = sorted.slice(-14, -7).reduce((sum, day) => sum + day.registrations, 0);
  const change = previous > 0 ? Math.round((recent - previous) / previous * 100) : null;
  const bars: { label: string; value: number; range: string }[] = [];
  const size = grouping === 'week' ? 7 : 1;
  for (let index = 0; index < sorted.length; index += size) {
    const group = sorted.slice(index, index + size);
    const start = dateLabel(group[0].date);
    const end = dateLabel(group[group.length - 1].date);
    bars.push({ label: grouping === 'week' ? `Week ${bars.length + 1}` : start, range: start === end ? start : `${start} – ${end}`, value: group.reduce((sum, day) => sum + day.registrations, 0) });
  }
  const visibleBars = bars.filter((bar) => bar.value > 0);
  const max = Math.max(1, ...visibleBars.map((bar) => bar.value));
  const unavailable = error && days.length === 0;

  return (
    <section className="registrations-panel" aria-labelledby="registrations-title" aria-busy={loading || refreshing}>
      <header className="registrations-header">
        <h3 id="registrations-title">New registrations</h3>
        <Dropdown menuClassName="registrations-grouping-menu" aria-label="Group registrations" value={grouping} onChange={(event) => setGrouping(event.target.value)}>
          <option value="week">By week</option><option value="day">By day</option>
        </Dropdown>
      </header>
      {loading ? <div className="registrations-state" role="status">Loading registrations…</div> : unavailable ? (
        <div className="registrations-state" role="alert"><p>Registrations could not be loaded.</p><button className="btn-secondary" onClick={onRetry}>Try again</button></div>
      ) : (
        <>
          {error && <p className="registrations-error" role="alert">Refresh failed. Showing the last available results. <button onClick={onRetry} disabled={refreshing}>Retry</button></p>}
          <div className="registrations-body">
            <dl className="registrations-summary">
              <div className="registrations-total-block"><dt>Last 30 days</dt><dd className="registrations-total">{total.toLocaleString()}</dd></div>
              <div className="registrations-today"><dt>Today</dt><dd>{today === undefined ? '—' : today.toLocaleString()}</dd></div>
              <div className="registrations-change">
                <dt>{change === null ? 'Last 7 days' : '7-day change'}</dt>
                <dd>{change === null ? recent.toLocaleString() : `${change > 0 ? '+' : ''}${change}%`}</dd>
                {change !== null && <span>vs previous 7 days</span>}
              </div>
            </dl>
            <div className="registrations-chart-heading">{grouping === 'day' ? 'Days with registrations' : 'Weekly registrations'}</div>
            <div className="registrations-chart" tabIndex={0} role="region" aria-label="Nonzero registration counts by date; scroll if needed">
              <div className={`registrations-bars${grouping === 'day' ? ' is-daily' : ''}`} style={{ '--registration-bar-count': Math.max(1, visibleBars.length) } as React.CSSProperties}>
                {visibleBars.map((bar, index) => (
                  <div key={bar.range} className={`registrations-column bar-tone-${index % 4}`} aria-label={`${bar.range}: ${bar.value.toLocaleString()} registrations`}>
                    <div className="registrations-bar-track">
                      <div className={`registrations-bar${bar.value / max < 0.2 ? ' is-short' : ''}`} style={{ height: `${bar.value / max * 100}%` }}>
                        <span className="registrations-bar-value">{bar.value.toLocaleString()}</span>
                      </div>
                    </div>
                    <span className="registrations-bar-label">{bar.label}</span>
                    {grouping === 'week' && <span className="registrations-bar-range">{bar.range}</span>}
                  </div>
                ))}
              </div>
              {total === 0 && <p className="registrations-empty">No registrations in this period.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
};
