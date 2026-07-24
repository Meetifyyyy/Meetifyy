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
} from 'lucide-react';
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
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: () => apiRequest('/admin/dashboard/stats'),
  });

  const { data: charts, isLoading: chartsLoading } = useQuery({
    queryKey: ['dashboardCharts'],
    queryFn: () => apiRequest('/admin/dashboard/charts'),
  });

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers || 0, icon: Users, color: '#6366f1' },
    { label: 'Active Today', value: stats?.activeToday || 0, icon: TrendingUp, color: '#10b981' },
    { label: 'New Today', value: stats?.newToday || 0, icon: Zap, color: '#f59e0b' },
    { label: 'Verified Students', value: stats?.verifiedStudents || 0, icon: UserCheck, color: '#3b82f6' },
    { label: 'Total Colleges', value: stats?.totalColleges || 0, icon: Building2, color: '#8b5cf6' },
    { label: 'Total Posts', value: stats?.totalPosts || 0, icon: FileText, color: '#ec4899' },
    { label: 'Pending Reports', value: stats?.pendingReports || 0, icon: ShieldAlert, color: '#ef4444' },
    { label: 'Open Support Tickets', value: stats?.openSupportTickets || 0, icon: HelpCircle, color: '#06b6d4' },
  ];

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>Platform Dashboard</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Real-time metrics, system health, and growth analytics across Meetifyy.
        </p>
      </div>

      {/* Infrastructure Health Status Widget */}
      <StatusWidget />

      {/* Health Stats Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1.25rem',
          marginBottom: '2rem',
        }}
      >
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className="glass-panel"
              style={{
                padding: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'transform 0.2s ease',
              }}
            >
              <div>
                <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  {card.label}
                </p>
                <p style={{ fontSize: '1.5rem', fontWeight: 800 }}>
                  {statsLoading ? '...' : card.value.toLocaleString()}
                </p>
              </div>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  background: `${card.color}20`,
                  border: `1px solid ${card.color}40`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon size={20} color={card.color} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Growth Chart */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem' }}>30-Day User Registrations</h3>
        {chartsLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading analytics...</div>
        ) : (
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts?.registrations || []}>
                <defs>
                  <linearGradient id="regGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                />
                <Area type="monotone" dataKey="registrations" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#regGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
