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
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className="glass-panel"
              style={{
                padding: '1rem 1.15rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-light)', marginBottom: '0.2rem' }}>
                  {card.label}
                </p>
                <p style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
                  {statsLoading ? '...' : card.value.toLocaleString()}
                </p>
              </div>
              <div
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
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--color-text-main)' }}>
          User Registrations (30 Days)
        </h3>
        {chartsLoading ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>Loading analytics...</div>
        ) : (
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts?.registrations || []}>
                <defs>
                  <linearGradient id="regGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="date" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                    color: '#0F172A',
                    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
                    fontSize: '12px',
                  }}
                />
                <Area type="monotone" dataKey="registrations" stroke="#2563EB" strokeWidth={2.5} fillOpacity={1} fill="url(#regGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
