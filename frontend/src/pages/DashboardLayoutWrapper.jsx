import { useEffect } from 'react';
import { Outlet, useNavigate, useMatches } from 'react-router-dom';
import Background from '../components/common/Background';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import DashboardLayout from '../components/layout/DashboardLayout';
import BottomNav from '../components/layout/BottomNav';

export default function DashboardLayoutWrapper() {
  const matches = useMatches();
  const navigate = useNavigate();
  
  // Determine if wide layout is needed based on route handle
  const isWide = matches.some(match => match.handle?.wide);
  const noPadding = matches.some(match => 
    match.pathname.startsWith('/messages') || 
    match.pathname.startsWith('/campus') ||
    match.pathname.startsWith('/profile')
  );
  
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
      <BottomNav />
    </>
  );
}
