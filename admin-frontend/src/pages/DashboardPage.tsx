import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { StatusWidget } from '../components/StatusWidget';
import {
  Users,
  Building2,
  FileText,
  ShieldAlert,
  HelpCircle,
  TrendingUp,
  UserCheck,
  Zap,
} from '../components/icons';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export const DashboardPage: React.FC = () => {
  /**
   * Live, like the health panel beside them.
   *
   * These two were fetched once per mount and then never again, so a dashboard
   * left open on a wall display or a second monitor showed the numbers as they
   * were whenever the tab was opened - with nothing on screen saying so. The
   * System Health widget above already refreshed every 30s, which made the
   * staleness harder to notice rather than easier: the panel that moved implied
   * the ones beside it were current too.
   *
   * 30s matches that widget. `refetchOnWindowFocus` covers the common case of
   * coming back to a tab that has been in the background, where the interval
   * has been throttled by the browser.
   */
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: () => apiRequest('/admin/dashboard/stats'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: charts, isLoading: chartsLoading } = useQuery({
    queryKey: ['dashboardCharts'],
    queryFn: () => apiRequest('/admin/dashboard/charts'),
    // The chart only changes when someone registers; a slower cadence is
    // plenty and keeps a 30-day aggregation off the 30s path.
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers || 0, icon: Users, color: '#2563EB' },
    { label: 'Active Today', value: stats?.activeToday || 0, icon: TrendingUp, color: '#10B981' },
    { label: 'New Registrations', value: stats?.newToday || 0, icon: Zap, color: '#F59E0B' },
    { label: 'Verified Students', value: stats?.verifiedStudents || 0, icon: UserCheck, color: '#3B82F6' },
    { label: 'Colleges', value: stats?.totalColleges || 0, icon: Building2, color: '#7C3AED' },
    { label: 'Total Posts', value: stats?.totalPosts || 0, icon: FileText, color: '#EC4899' },
    { label: 'Pending Reports', value: stats?.pendingReports || 0, icon: ShieldAlert, color: '#EF4444' },
    { label: 'Support Tickets', value: stats?.openSupportTickets || 0, icon: HelpCircle, color: '#06B6D4' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-subtitle">Overview & metrics across Meetifyy.</p>
        </div>
      </div>

      <StatusWidget />

      {/* Metrics Grid */}
      <div
        className="dashboard-metrics-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
          gap: '0.85rem',
          marginBottom: '1.5rem',
        }}
      >
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className="glass-panel dashboard-stat-card"
              style={{
                padding: '1rem 1.15rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <p className="dashboard-stat-label" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-light)', marginBottom: '0.2rem' }}>
                  {card.label}
                </p>
                <p className="dashboard-stat-value" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
                  {statsLoading ? '...' : card.value.toLocaleString()}
                </p>
              </div>
              <div
                className="dashboard-stat-icon-wrap"
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  background: `${card.color}14`,
                  border: `1px solid ${card.color}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon size={18} color={card.color} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Analytics Chart */}
      <div className="glass-panel dashboard-chart-card" style={{ padding: '1.25rem' }}>
        {(() => {
          const regData = charts?.registrations || [];
          const total30d = regData.reduce((acc: number, cur: any) => acc + (cur.registrations || 0), 0);

          return (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                <div>
                  <h3 className="dashboard-chart-title" style={{ fontSize: '0.88rem', fontWeight: 700, margin: 0, color: 'var(--color-text-main)' }}>
                    User Registrations (30 Days)
                  </h3>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
                    Daily verified and student accounts created
                  </p>
                </div>
                <div style={{ background: 'var(--color-primary-tint)', border: '1px solid rgba(37, 99, 235, 0.2)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                  {total30d} total
                </div>
              </div>

              {chartsLoading ? (
                <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.8rem' }}>Loading analytics...</div>
              ) : (
                <div className="dashboard-chart-container" style={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={regData}
                      margin={{ top: 10, right: 10, left: -24, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="regGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563EB" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#2563EB" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="#94A3B8"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                        tickFormatter={(val: string) => {
                          try {
                            const d = new Date(val);
                            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                          } catch {
                            return val;
                          }
                        }}
                      />
                      <YAxis
                        stroke="#94A3B8"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        domain={[0, (dataMax: number) => Math.max(dataMax + 1, 3)]}
                      />
                      <Tooltip
                        cursor={{ stroke: '#94A3B8', strokeWidth: 1, strokeDasharray: '3 3' }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const formattedDate = (() => {
                            if (!label) return '';
                            try {
                              return new Date(String(label)).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              });
                            } catch {
                              return String(label);
                            }
                          })();
                          const count = payload[0].value ?? 0;
                          return (
                            <div
                              style={{
                                background: 'var(--color-bg-white)',
                                border: '1px solid var(--color-border)',
                                borderRadius: '8px',
                                padding: '0.45rem 0.65rem',
                                boxShadow: '0 4px 14px rgba(15, 23, 42, 0.1)',
                                fontSize: '0.74rem',
                              }}
                            >
                              <div style={{ color: 'var(--color-text-light)', fontWeight: 500, marginBottom: '0.15rem' }}>
                                {formattedDate}
                              </div>
                              <div style={{ fontWeight: 700, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--color-primary)' }} />
                                <span>{count} {count === 1 ? 'registration' : 'registrations'}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="registrations"
                        stroke="#2563EB"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#regGradient)"
                        activeDot={{ r: 4, stroke: '#2563EB', strokeWidth: 2, fill: '#FFFFFF' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};
