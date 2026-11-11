import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from './ConfirmProvider';
import {
  Activity,
  LayoutDashboard,
  Building2,
  Users,
  ShieldAlert,
  HelpCircle,
  FileText,
  ShieldCheck,
  LogOut,
  Megaphone,
  Menu,
  Sidebar,
  X,
  CheckCircle,
  Trash2,
  BookOpen,
} from './icons';

export const AdminLayout: React.FC = () => {
  const { admin, logout } = useAuth();
  const confirm = useConfirm();
  // The signed-in admin as a person: their name, or their email when the
  // account has none.
  const adminIdentity = admin?.name?.trim() || admin?.email || '';
  const location = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
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

  useLayoutEffect(() => {
    // The white work surface owns scrolling; the document must not move too.
    document.documentElement.classList.add('admin-viewport');
    return () => document.documentElement.classList.remove('admin-viewport');
  }, []);

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname]);

  // Close mobile nav on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  // Lock body scrolling when mobile navigation drawer is open
  useEffect(() => {
    if (isMobile && isMobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, isMobileOpen]);

  // Drawer focus is UI-only; authentication and route handling stay unchanged.
  useEffect(() => {
    if (!isMobile || !isMobileOpen) return;
    const sidebar = sidebarRef.current;
    const controls = () => Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') || []);
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileOpen(false);
        menuRef.current?.focus();
      }
      if (event.key === 'Tab') {
        const items = controls();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobile, isMobileOpen]);

  const requestLogout = () => {
    const opener = document.activeElement as HTMLElement | null;
    const fromDrawer = isMobile && isMobileOpen;
    setIsMobileOpen(false);
    confirm({
      title: 'Log out?',
      description: 'Are you sure you want to log out of the admin portal?',
      severity: 'moderate',
      confirmLabel: 'Log out',
      cancelLabel: 'Stay signed in',
      onConfirm: logout,
      onCancel: () => {
        if (fromDrawer) menuRef.current?.focus();
        else if (opener?.isConnected) opener.focus();
      },
    });
  };

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', group: 'Workspace', icon: LayoutDashboard },
    { label: 'Colleges', path: '/colleges', group: 'Workspace', icon: Building2, badge: pendingCount },
    { label: 'Users', path: '/users', group: 'Workspace', icon: Users },
    { label: 'Campus Reps', path: '/campus-reps', group: 'Workspace', icon: Megaphone },
    { label: 'Moderation', path: '/reports', group: 'Trust & support', icon: ShieldAlert },
    { label: 'Support', path: '/support', group: 'Trust & support', icon: HelpCircle },
    { label: 'Analytics', path: '/analytics', group: 'Workspace', icon: Activity },
    { label: 'Verification', path: '/verification', group: 'Trust & support', icon: CheckCircle },
    // Its own entry rather than a tab under Users: these rows carry a retention
    // deadline the platform has committed to, which is a different job from
    // moderating an account.
    { label: 'Account Deletion', path: '/account-deletion', group: 'Trust & support', icon: Trash2 },
    // Terms, Privacy, Cookies, Community Guidelines: drafts, publishing and
    // the update screen. Active for the document and editor sub-pages too.
    { label: 'Legal', path: '/legal', group: 'Administration', icon: BookOpen },
    { label: 'Audit Logs', path: '/audit', group: 'Administration', icon: FileText },
    { label: 'Sessions', path: '/sessions', group: 'Administration', icon: ShieldCheck },
  ];

  const showText = isMobile || isExpanded;

  return (
    <div className={`admin-shell${isExpanded ? ' admin-shell-expanded' : ''}`}>
      <a className="skip-link" href="#admin-main">Skip to content</a>
      {isMobile && (
        <header className="admin-mobile-header">
          <button ref={menuRef} className="admin-icon-button" onClick={() => setIsMobileOpen(!isMobileOpen)} aria-label="Open navigation" aria-expanded={isMobileOpen} aria-controls="admin-sidebar"><Menu size={22} /></button>
          <div className="admin-mobile-brand"><img src="/admin-avatar.jpg" alt="" width={32} height={32} /><span className="admin-mobile-brand-name">Admin</span></div>
          <button className="admin-icon-button" onClick={requestLogout} aria-label="Log out" title="Log out"><LogOut size={19} /></button>
        </header>
      )}
      {isMobile && <div className="admin-drawer-backdrop" data-open={isMobileOpen} aria-hidden="true" onClick={() => { setIsMobileOpen(false); menuRef.current?.focus(); }} />}
      <aside id="admin-sidebar" ref={sidebarRef} data-expanded={showText} className={`admin-sidebar${isMobileOpen ? ' is-open' : ''}`} inert={isMobile && !isMobileOpen} aria-label="Admin navigation">
        <div className="admin-sidebar-brand">
          <img src="/meetifyy-wordmark.svg" alt="Meetifyy" className="admin-sidebar-wordmark" aria-hidden={!showText} />
          {isMobile ? (
            <button className="admin-icon-button admin-rail-toggle" aria-label="Close navigation" onClick={() => { setIsMobileOpen(false); menuRef.current?.focus(); }}><X size={20} /></button>
          ) : (
            <button className="admin-icon-button admin-rail-toggle" onClick={() => setIsExpanded(!isExpanded)} aria-label={isExpanded ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={isExpanded} aria-controls="admin-navigation" title={isExpanded ? 'Collapse navigation' : 'Expand navigation'}><Sidebar size={20} /></button>
          )}
        </div>
        <nav id="admin-navigation" className="admin-navigation" aria-label="Main">
          {['Workspace', 'Trust & support', 'Administration'].map((group) => (
            <div key={group} className="admin-nav-group" role="group" aria-label={group}>
              <p className="admin-nav-group-title" aria-hidden={!showText}>{group}</p>
              {navItems.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path || (item.path === '/legal' && location.pathname.startsWith('/legal/'));
                return (
                  <NavLink key={item.path} to={item.path} onClick={() => isMobile && setIsMobileOpen(false)} aria-label={item.label} title={!showText ? item.label : undefined} className={`admin-nav-link${isActive ? ' is-active' : ''}`}>
                    <span className="admin-nav-icon" aria-hidden="true"><Icon size={19} />{!!item.badge && item.badge > 0 && <span className="admin-nav-badge">{item.badge}</span>}</span>
                    <span className="admin-nav-label" aria-hidden={!showText}>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <div className="admin-identity" aria-hidden={!showText} title={admin?.email || undefined}><img className="admin-avatar" src="/admin-avatar.jpg" alt="" width={32} height={32} /><div><strong>{adminIdentity || 'Signed in'}</strong><small>{admin?.name && admin.email ? admin.email : 'Admin'}</small></div></div>
          <button className="admin-icon-button" onClick={requestLogout} title="Log out" aria-label="Log out"><LogOut size={19} /></button>
        </div>
      </aside>
      <main id="admin-main" className="admin-main" tabIndex={-1} inert={isMobile && isMobileOpen}>
        <div ref={contentRef} className="admin-content-surface"><div key={location.pathname} className="page-container admin-page-transition"><Outlet /></div></div>
      </main>
    </div>
  );
};
