import { useLocation, Outlet, useNavigate } from 'react-router-dom';
import Background from '../components/common/Background';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import DashboardLayout from '../components/layout/DashboardLayout';
import BottomNav from '../components/layout/BottomNav';

export default function DashboardLayoutWrapper() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Determine if wide layout is needed based on path
  const isWide = 
    location.pathname.startsWith('/communities') || 
    location.pathname.startsWith('/colleges') || 
    location.pathname.startsWith('/messages') ||
    location.pathname.startsWith('/profile');
  const handleCommunityClick = (id) => {
    navigate(`/communities/${id}`);
  };

  return (
    <>
      <Background />
      <Header variant="dashboard" />
      <DashboardLayout wide={isWide}>
        <Sidebar onCommunityClick={handleCommunityClick} />
        <Outlet />
      </DashboardLayout>
      <BottomNav />
    </>
  );
}
