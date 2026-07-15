import { useEffect } from 'react';
import { Outlet, useNavigate, useMatches } from 'react-router-dom';
import Background from '@shared/components/ui/Background';
import Header from './Header';
import Sidebar from './Sidebar';
import DashboardLayout from './DashboardLayout';
import BottomNav from './BottomNav';

export default function DashboardLayoutWrapper() {
  const matches = useMatches();
  const navigate = useNavigate();
  
  // Determine if wide layout is needed based on route handle
  const isWide = matches.some(match => match.handle?.wide);
  const noPadding = matches.some(match => 
    match.pathname.startsWith('/messages') || 
    match.pathname.startsWith('/campus') ||
    match.pathname.startsWith('/profile') ||
    match.pathname.startsWith('/post') ||
    match.pathname.startsWith('/saved') ||
    /^\/communities\/.+/.test(match.pathname)
  );
  const isSavedPage = matches.some(match => match.pathname.startsWith('/saved'));
  
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const handleCommunityClick = (id) => {
    navigate(`/communities/${id}`);
  };

  return (
    <>
      <Background />
      <Header variant="dashboard" />
      <DashboardLayout wide={isWide} noPaddingMobile={noPadding}>
        <Sidebar onCommunityClick={handleCommunityClick} />
        <Outlet />
      </DashboardLayout>
      {!isSavedPage && <BottomNav />}
    </>
  );
}
