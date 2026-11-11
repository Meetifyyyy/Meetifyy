import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { StatusWidget } from '../components/StatusWidget';
import { UserMetricsCard } from '../components/UserMetricsCard';
import './dashboard.css';
import { RegistrationChart } from '../components/RegistrationChart';

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

  const { data: charts, isLoading: chartsLoading, isError: chartsError, isRefetching: chartsRefreshing, refetch: refetchCharts } = useQuery({
    queryKey: ['dashboardCharts'],
    queryFn: () => apiRequest('/admin/dashboard/charts'),
    // The chart only changes when someone registers; a slower cadence is
    // plenty and keeps a 30-day aggregation off the 30s path.
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });

  const statCards = [
    { tone: 'moderation', metrics: [
      { label: 'Pending reports', value: stats?.pendingReports ?? 0 },
      { label: 'Support tickets', value: stats?.openSupportTickets ?? 0 },
    ] },
    { tone: 'colleges', metrics: [{ label: 'Colleges', value: stats?.totalColleges ?? 0 }] },
    { tone: 'posts', metrics: [{ label: 'Total posts', value: stats?.totalPosts ?? 0 }] },
  ];

  return (
    <div className="admin-page admin-dashboard">
      <div className="page-header">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-subtitle">Overview & metrics across Meetifyy.</p>
        </div>
      </div>

      <div className="dashboard-overview">
        <div className="dashboard-overview-metrics" aria-label="Platform metrics">
          <UserMetricsCard total={stats?.totalUsers ?? 0} verified={stats?.verifiedStudents ?? 0} active={stats?.activeToday ?? 0} loading={statsLoading} />
          {statCards.map((card) => (
            <dl key={card.tone} className={`dashboard-metric-group tone-${card.tone}${card.metrics.length === 1 ? ' is-single' : ''}`}>
              {card.metrics.map((metric, index) => (
                <div key={metric.label} className={index === 0 ? 'dashboard-metric-primary' : 'dashboard-metric-primary dashboard-metric-following'}>
                  <dt>{metric.label}</dt>
                  <dd>{statsLoading ? '…' : metric.value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>

        <StatusWidget />
      </div>

      <RegistrationChart
        days={charts?.registrations ?? []}
        today={stats?.newToday}
        loading={chartsLoading}
        error={chartsError}
        refreshing={chartsRefreshing}
        onRetry={() => void refetchCharts()}
      />
    </div>
  );
};
