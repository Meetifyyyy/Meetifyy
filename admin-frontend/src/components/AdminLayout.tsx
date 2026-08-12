import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Building2,
  Users,
  ShieldAlert,
  HelpCircle,
  Flag,
  Settings,
  FileText,
  ShieldCheck,
  LogOut,
  Sparkles,
  Megaphone,
  Menu,
  X,
} from 'lucide-react';

export const AdminLayout: React.FC = () => {
  const { admin, logout } = useAuth();
  const location = useLocation();
  const [isHovered, setIsHovered] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  const { data: requestsBadgeData } = useQuery({
    queryKey: ['adminCollegeRequestsBadge'],
    queryFn: () => apiRequest('/admin/colleges/requests/list?status=PENDING'),
    refetchInterval: 15000,
  });

  const pendingCount = requestsBadgeData?.data?.length || 0;

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close mobile nav on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Colleges', path: '/colleges', icon: Building2, badge: pendingCount },
    { label: 'Users', path: '/users', icon: Users },
    { label: 'Campus Reps', path: '/campus-reps', icon: Megaphone },
    { label: 'Moderation', path: '/reports', icon: ShieldAlert },
    { label: 'Support', path: '/support', icon: HelpCircle },
    { label: 'Feature Flags', path: '/flags', icon: Flag },
    { label: 'Settings', path: '/settings', icon: Settings },
    { label: 'Audit Logs', path: '/audit', icon: FileText },
    { label: 'Sessions', path: '/sessions', icon: ShieldCheck },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-main)', display: 'flex', flexDirection: 'column' }}>
      {/* MOBILE TOP HEADER */}
      {isMobile && (
        <header
          style={{
            height: '60px',
            background: 'var(--color-bg-white)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 1rem',
            position: 'sticky',
            top: 0,
            zIndex: 35,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-main)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.35rem',
              }}
              aria-label="Toggle Menu"
            >
              {isMobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles size={15} color="#fff" />
              </div>
              <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-text-main)' }}>Meetifyy</span>
              <span
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  background: 'var(--color-primary-tint)',
                  padding: '1px 5px',
                  borderRadius: '4px',
                }}
              >
                ADMIN
              </span>
            </div>
          </div>

          <button
            onClick={logout}
            style={{
              background: 'var(--color-danger-tint)',
              border: '1px solid rgba(239,68,68,0.2)',
              color: 'var(--color-danger-hover)',
              padding: '0.35rem 0.65rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        </header>
      )}

      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        {/* MOBILE OVERLAY BACKDROP */}
        {isMobile && isMobileOpen && (
          <div
            onClick={() => setIsMobileOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 40,
            }}
          />
        )}

        {/* SIDEBAR NAVIGATION */}
        <aside
          onMouseEnter={() => !isMobile && setIsHovered(true)}
          onMouseLeave={() => !isMobile && setIsHovered(false)}
          style={{
            width: isMobile ? '260px' : isHovered ? '240px' : '68px',
            background: 'var(--color-bg-white)',
            borderRight: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            position: 'fixed',
            top: isMobile ? '60px' : 0,
            bottom: 0,
            left: 0,
            zIndex: 45,
            boxShadow: isHovered || isMobileOpen ? '0 10px 30px rgba(15, 23, 42, 0.08)' : 'none',
            transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s ease, box-shadow 0.25s ease',
            transform: isMobile ? (isMobileOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
            overflowX: 'hidden',
          }}
        >
          {/* BRAND HEADER (Desktop) */}
          {!isMobile && (
            <div
              style={{
                height: '65px',
                minHeight: '65px',
                maxHeight: '65px',
                padding: '0 0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                borderBottom: '1px solid var(--color-border)',
                boxSizing: 'border-box',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 2px 8px rgba(37, 99, 235, 0.2)',
                }}
              >
                <Sparkles size={18} color="#fff" />
              </div>

              <div
                style={{
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 0.2s ease',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  minWidth: 0,
                }}
              >
                <h1 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--color-text-main)' }}>Meetifyy</h1>
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    color: 'var(--color-primary)',
                    background: 'var(--color-primary-tint)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    display: 'inline-block',
                  }}
                >
                  SUPER ADMIN
                </span>
              </div>
            </div>
          )}

          {/* NAV LINKS */}
          <nav style={{ padding: '0.75rem 0.5rem', flex: 1, overflowY: 'auto' }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              const showText = isMobile || isHovered;

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={!showText ? item.label : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0 0.75rem',
                    height: '42px',
                    borderRadius: 'var(--radius-sm)',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    background: isActive ? 'var(--color-primary-tint)' : 'transparent',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '0.85rem',
                    textDecoration: 'none',
                    marginBottom: '0.2rem',
                    transition: 'background 0.15s ease, color 0.15s ease',
                    whiteSpace: 'nowrap',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', flexShrink: 0 }}>
                    <Icon size={18} color={isActive ? 'var(--color-primary)' : 'var(--color-text-light)'} />
                  </div>
                  <span
                    style={{
                      opacity: showText ? 1 : 0,
                      transition: 'opacity 0.2s ease',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{item.label}</span>
                    {!!item.badge && item.badge > 0 && (
                      <span
                        style={{
                          background: 'var(--color-danger)',
                          color: '#fff',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          borderRadius: '10px',
                          padding: '1px 6px',
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                </NavLink>
              );
            })}
          </nav>

          {/* USER FOOTER */}
          {!isMobile && (
            <div
              style={{
                height: '60px',
                minHeight: '60px',
                maxHeight: '60px',
                padding: '0 0.75rem',
                borderTop: '1px solid var(--color-border)',
                background: 'var(--color-bg-alt)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: isHovered ? 'space-between' : 'center',
                boxSizing: 'border-box',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  overflow: 'hidden',
                  flex: 1,
                }}
              >
                <div
                  style={{
                    opacity: isHovered ? 1 : 0,
                    transition: 'opacity 0.2s ease',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-main)', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {admin?.name || 'Super Admin'}
                  </p>
                  <p style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {admin?.email || ''}
                  </p>
                </div>
              </div>

              <button
                onClick={logout}
                title="Log Out"
                style={{
                  background: 'var(--color-danger-tint)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: 'var(--color-danger-hover)',
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </aside>

        {/* MAIN CONTENT VIEWPORT */}
        <main
          style={{
            marginLeft: isMobile ? 0 : '68px',
            flex: 1,
            padding: isMobile ? '1.25rem 1rem' : '2rem 2.5rem',
            minWidth: 0,
            transition: 'margin-left 0.2s ease',
          }}
        >
          <div className="page-container">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
