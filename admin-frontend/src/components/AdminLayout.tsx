import React, { useState } from 'react';
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
  const [isHovered, setIsHovered] = useState(false);

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
      {/* SIDEBAR - COLLAPSED ICON MODE, EXPANDS ON HOVER */}
      <aside
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: isHovered ? '250px' : '68px',
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 40,
          boxShadow: isHovered ? '10px 0 30px rgba(0, 0, 0, 0.5)' : 'none',
          transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.22s ease',
          overflowX: 'hidden',
        }}
      >
        {/* BRAND HEADER */}
        <div
          style={{
            padding: '1.25rem 0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            borderBottom: '1px solid var(--border-color)',
            minHeight: '70px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)',
              flexShrink: 0,
            }}
          >
            <Sparkles size={19} color="#fff" />
          </div>

          <div
            style={{
              opacity: isHovered ? 1 : 0,
              transition: 'opacity 0.18s ease',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              pointerEvents: isHovered ? 'auto' : 'none',
            }}
          >
            <h1 style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.5px', margin: 0, color: '#fff' }}>Meetifyy</h1>
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                color: '#a7f3d0',
                background: 'rgba(16, 185, 129, 0.15)',
                padding: '1px 6px',
                borderRadius: '4px',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'inline-block',
                marginTop: '1px',
              }}
            >
              SUPER ADMIN
            </span>
          </div>
        </div>

        {/* NAVIGATION LINKS */}
        <nav style={{ padding: '0.85rem 0.6rem', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {isHovered && (
            <div
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                padding: '0.4rem 0.6rem',
                marginBottom: '0.2rem',
                whiteSpace: 'nowrap',
              }}
            >
              Management
            </div>
          )}

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                title={!isHovered ? item.label : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.85rem',
                  padding: '0.65rem 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  background: isActive ? 'linear-gradient(90deg, rgba(99, 102, 241, 0.25), rgba(139, 92, 246, 0.15))' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '0.875rem',
                  textDecoration: 'none',
                  marginBottom: '0.25rem',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', flexShrink: 0 }}>
                  <Icon size={19} color={isActive ? '#818cf8' : '#64748b'} />
                </div>
                <span
                  style={{
                    opacity: isHovered ? 1 : 0,
                    transition: 'opacity 0.18s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </nav>

        {/* USER PROFILE FOOTER */}
        <div
          style={{
            padding: isHovered ? '0.85rem 1rem' : '0.85rem 0.6rem',
            borderTop: '1px solid var(--border-color)',
            background: 'rgba(0, 0, 0, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: isHovered ? 'space-between' : 'center',
            minHeight: '65px',
            boxSizing: 'border-box',
          }}
        >
          {isHovered ? (
            <>
              <div style={{ overflow: 'hidden' }}>
                <p style={{ fontSize: '0.83rem', fontWeight: 700, color: '#fff', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
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
                  padding: '0.45rem',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <LogOut size={16} />
              </button>
            </>
          ) : (
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
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT VIEWPORT - FIXED AT 68px LEFT MARGIN */}
      <main style={{ marginLeft: '68px', flex: 1, padding: '2rem 2.5rem', minWidth: 0, transition: 'margin-left 0.22s ease' }}>
        <Outlet />
      </main>
    </div>
  );
};
