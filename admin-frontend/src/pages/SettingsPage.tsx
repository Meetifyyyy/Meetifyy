import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Save } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState('string');
  const [newDesc, setNewDesc] = useState('');

  const { data: settings, isLoading } = useQuery({
    queryKey: ['adminSettings'],
    queryFn: () => apiRequest('/admin/settings'),
  });

  const saveMutation = useMutation({
    mutationFn: (setting: any) =>
      apiRequest('/admin/settings', {
        method: 'POST',
        body: JSON.stringify(setting),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSettings'] });
      setNewKey('');
      setNewValue('');
      setNewDesc('');
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Platform Settings</h2>
          <p className="page-subtitle">Global environment configurations and system variables.</p>
        </div>
      </div>

      {/* Add / Update Setting Bar */}
      <div className="glass-panel" style={{ padding: '1.15rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '0.75rem' }}>Set Variable</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.65rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Setting Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="input-control"
          />
          <input
            type="text"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="input-control"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="input-control"
          >
            <option value="string">string</option>
            <option value="boolean">boolean</option>
            <option value="number">number</option>
            <option value="json">json</option>
          </select>
          <input
            type="text"
            placeholder="Description..."
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="input-control"
          />
          <button
            onClick={() => saveMutation.mutate({ key: newKey, value: newValue, type: newType, description: newDesc })}
            disabled={!newKey || !newValue}
            className="btn-primary"
            style={{ justifyContent: 'center' }}
          >
            <Save size={14} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Settings Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
            Loading settings...
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {settings?.map((s: any) => (
                  <tr key={s.key}>
                    <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{s.key}</td>
                    <td style={{ fontFamily: 'monospace', color: 'var(--color-text-main)', fontSize: '0.82rem' }}>{s.value}</td>
                    <td><span className="badge badge-info">{s.type}</span></td>
                    <td style={{ color: 'var(--color-text-light)', fontSize: '0.82rem' }}>{s.description || '—'}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)', textAlign: 'right' }}>{new Date(s.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {settings?.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '2.5rem 1rem' }}>
                      No custom settings stored.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
