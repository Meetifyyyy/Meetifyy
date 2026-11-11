import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import './StatusWidget.css';

interface ComponentHealth {
  status: 'UP' | 'DOWN';
  latencyMs?: number;
  detail?: string;
}

export const StatusWidget: React.FC = () => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = React.useId();
  const { data: status, isLoading, isError, dataUpdatedAt, refetch, isRefetching } = useQuery<Record<string, ComponentHealth>>({
    queryKey: ['platformStatus'],
    queryFn: () => apiRequest('/admin/dashboard/platform-status'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const services = Object.entries(status ?? {});
  const down = services.filter(([, info]) => info.status === 'DOWN');
  const unavailable = isError || (!isLoading && services.length === 0);
  const healthy = !isLoading && !unavailable && down.length === 0;
  const tone = down.length ? 'down' : healthy ? 'healthy' : 'unknown';
  const headline = down.length
    ? `${down.length} service${down.length === 1 ? '' : 's'} down`
    : isLoading ? 'Checking services…' : unavailable ? 'Health check unavailable' : 'All systems operational';
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button type="button" className={`meetifyy-health-card is-${tone}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`Meetifyy health: ${headline}. View service details`}
        onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}>
        <span className="meetifyy-health-heading">Meetifyy health</span>
        <span className="meetifyy-health-summary" aria-live="polite">
          <strong>{down.length ? 'Needs attention.' : healthy ? 'Healthy.' : isLoading ? 'Checking…' : 'Unavailable.'}</strong>
          {down.length > 0 && <span>{down.map(([name]) => name).join(', ')} down</span>}
        </span>
      </button>

      <dialog ref={dialogRef} className="health-detail-dialog" aria-labelledby={titleId}
        onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
        } }}>
        <div className="dialog-header">
          <div><h2 id={titleId}>Meetifyy health</h2><p className="health-detail-subtitle">Service status and response latency</p></div>
          <button type="button" className="dialog-close" aria-label="Close health details" onClick={close}><span aria-hidden="true">×</span></button>
        </div>
        <div className="health-detail-body">
          <div className={`health-detail-summary is-${tone}`} role="status">
            <span className="health-detail-status-dot" /><strong>{headline}</strong>
          </div>
          {isError && <p className="health-detail-error" role="alert">Could not refresh service health. {status ? 'The results below are from the last successful check.' : 'Try refreshing to check again.'}</p>}
          {isLoading ? <p className="health-detail-subtitle">Checking services…</p> : services.length === 0 ? <p className="health-detail-subtitle">No service results available.</p> : (
            <ul className="health-detail-services">
              {services.map(([name, info]) => (
                <li key={name} className="health-detail-service">
                  <div className="health-detail-service-title"><strong>{name}</strong>{info.detail && <p>{info.detail}</p>}</div>
                  <span className={`badge ${info.status === 'UP' ? 'badge-success' : 'badge-danger'}`}>{info.status === 'UP' ? 'Operational' : 'Down'}</span>
                  <span className="health-detail-latency">Latency <strong>{info.latencyMs !== undefined ? `${info.latencyMs} ms` : 'Not measured'}</strong></span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="health-detail-footer">
          <span>{dataUpdatedAt ? `Last checked ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for a successful check'}<small>Updates every 30 seconds</small></span>
          <button type="button" className="btn-secondary" disabled={isRefetching} onClick={() => void refetch()}>{isRefetching ? 'Checking…' : 'Refresh'}</button>
        </footer>
      </dialog>
    </>
  );
};
