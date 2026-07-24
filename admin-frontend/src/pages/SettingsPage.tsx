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
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>Platform Settings</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Global platform configurations, maintenance modes, upload limits, and support contacts.
        </p>
      </div>

      {/* Add New Setting Bar */}
      <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Add / Update Setting</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 2fr auto', gap: '0.75rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Setting Key (e.g. maintenance_mode)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            style={{ padding: '0.6rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
          />
          <input
            type="text"
            placeholder="Value (e.g. false)"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            style={{ padding: '0.6rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            style={{ padding: '0.6rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
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
            style={{ padding: '0.6rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
          />
          <button
            onClick={() => saveMutation.mutate({ key: newKey, value: newValue, type: newType, description: newDesc })}
            disabled={!newKey || !newValue}
            className="btn-primary"
          >
            <Save size={16} /> Save
          </button>
        </div>
      </div>

      {/* Settings Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading settings...</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Type</th>
                <th>Description</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {settings?.map((s: any) => (
                <tr key={s.key}>
                  <td style={{ fontWeight: 700, color: '#818cf8' }}>{s.key}</td>
                  <td style={{ fontFamily: 'monospace', color: '#fff' }}>{s.value}</td>
                  <td><span className="badge badge-info">{s.type}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{s.description || 'N/A'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{new Date(s.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {settings?.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    No system settings configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
