import React from 'react';

interface UserMetricsCardProps {
  total: number;
  verified: number;
  active: number;
  loading: boolean;
}

export const UserMetricsCard: React.FC<UserMetricsCardProps> = ({ total, verified, active, loading }) => {
  // Each arc compares its own count with total users. Active and verified
  // overlap, so they must not be stacked as if they were separate populations.
  const rings = [
    { key: 'verified', value: verified, inner: 112, outer: 130 },
    { key: 'active', value: active, inner: 94, outer: 102 },
  ];
  const format = (value: number) => loading ? '…' : value.toLocaleString();
  const totalLabel = format(total);
  const gaugeTotal = !loading && totalLabel.length > 6
    ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(total)
    : totalLabel;

  return (
    <section className="dashboard-users-card" aria-label="User overview" aria-busy={loading}>
      <h3>Users</h3>
      <div className="dashboard-users-body">
        <div className="dashboard-users-gauge">
          <svg viewBox="0 0 300 174" aria-hidden="true">
            {rings.map((ring) => {
              const filled = loading || total <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, ring.value / total)) * 32);
              return Array.from({ length: 32 }, (_, index) => {
                const angle = Math.PI - ((index + 0.5) / 32) * Math.PI;
                return <line key={`${ring.key}-${index}`} className={`users-gauge-segment ring-${ring.key}${index < filled ? ' is-filled' : ''}`}
                  x1={150 + Math.cos(angle) * ring.inner} y1={148 - Math.sin(angle) * ring.inner}
                  x2={150 + Math.cos(angle) * ring.outer} y2={148 - Math.sin(angle) * ring.outer} />;
              });
            })}
          </svg>
          <div className="dashboard-users-total"><strong aria-label={totalLabel} title={totalLabel}>{gaugeTotal}</strong><span>Total users</span></div>
        </div>
        <dl className="dashboard-users-legend">
          <div className="users-legend-verified"><dt><span />Selfie-verified users</dt><dd>{format(verified)}</dd></div>
          <div className="users-legend-active"><dt><span />Active today</dt><dd>{format(active)}</dd></div>
        </dl>
      </div>
    </section>
  );
};
