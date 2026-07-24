import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Building2,
  Users,
  ShieldAlert,
  HelpCircle,
  BarChart3,
  Flag,
  Settings,
  FileText,
  ShieldCheck,
  LogOut,
  Sparkles,
} from 'lucide-react';

export const AdminLayout: React.FC = () => {
  const { admin, logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Colleges', path: '/colleges', icon: Building2 },
    { label: 'Users', path: '/users', icon: Users },
    { label: 'Reports', path: '/reports', icon: ShieldAlert },
    { label: 'Support', path: '/support', icon: HelpCircle },
    { label: 'Analytics', path: '/analytics', icon: BarChart3 },
    { label: 'Feature Flags', path: '/flags', icon: Flag },
    { label: 'Settings', path: '/settings', icon: Settings },
    { label: 'Audit Logs', path: '/audit', icon: FileText },
    { label: 'Security & Sessions', path: '/sessions', icon: ShieldCheck },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-dark)' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '260px',
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 40,
        }}
      >
        {/* Brand Header */}
        <div
          style={{
            padding: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)',
            }}
          >
            <Sparkles size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.5px' }}>Meetifyy</h1>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#a7f3d0',
                background: 'rgba(16, 185, 129, 0.15)',
                padding: '1px 6px',
                borderRadius: '4px',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              SUPER ADMIN
            </span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav style={{ padding: '1rem 0.75rem', flex: 1, overflowY: 'auto' }}>
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              padding: '0.5rem 0.75rem',
              marginBottom: '0.25rem',
            }}
          >
            Management
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  background: isActive ? 'linear-gradient(90deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.1))' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '0.875rem',
                  textDecoration: 'none',
                  marginBottom: '0.25rem',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={18} color={isActive ? '#818cf8' : '#64748b'} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div
          style={{
            padding: '1rem',
            borderTop: '1px solid var(--border-color)',
            background: 'rgba(0, 0, 0, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ overflow: 'hidden' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {admin?.name || 'Super Admin'}
            </p>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {admin?.email || ''}
            </p>
          </div>
          <button
            onClick={logout}
            title="Log Out"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              padding: '0.5rem',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <main style={{ marginLeft: '260px', flex: 1, padding: '2rem 2.5rem', minWidth: 0 }}>
        <Outlet />
      </main>
    </div>
  );
};
