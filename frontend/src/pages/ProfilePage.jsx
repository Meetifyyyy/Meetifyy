import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Background from '../components/common/Background';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import DashboardLayout from '../components/layout/DashboardLayout';
import RightPanel from '../components/layout/RightPanel';
import ProfileHeader from '../components/profile/ProfileHeader';
import ProfileAbout from '../components/profile/ProfileAbout';
import ProfileActivity from '../components/profile/ProfileActivity';
import BottomNav from '../components/layout/BottomNav';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { username } = useAuth();

  const handleTabChange = (tab) => {
    navigate('/home');
  };

  const handleCommunityClick = (id) => {
    navigate('/home');
  };

  const friends = [
    { name: 'Alice', letter: 'A', status: '3 mutual', online: true },
    { name: 'Marcus', letter: 'M', status: '5 mutual', online: true },
    { name: 'Priya', letter: 'P', status: '2 mutual', online: false },
    { name: 'Jordan', letter: 'J', status: '1 mutual', online: false },
  ];

  return (
    <>
      <Background />
      <Header variant="dashboard" />
      <DashboardLayout>
        <Sidebar activeTab="" onTabChange={handleTabChange} onCommunityClick={handleCommunityClick} />
        <main className="centre">
          <ProfileHeader />
          <ProfileAbout />
          <ProfileActivity />
        </main>
        <RightPanel>
          <div className="panel-card">
            <h3 className="panel-title">Quick Actions</h3>
            <button className="action-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Edit Profile
            </button>
            <button className="action-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Share Profile
            </button>
            <button className="action-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
              </svg>
              Share Feedback
            </button>
          </div>

          <div className="panel-card">
            <h3 className="panel-title">Mutual Friends</h3>
            {friends.map((f, i) => (
              <div key={i} className="friend-item">
                <div className="friend-avatar">{f.letter}</div>
                <div className="friend-info">
                  <div className="friend-name">{f.name}</div>
                  <div className={`friend-status${f.online ? ' online' : ''}`}>{f.status}</div>
                </div>
              </div>
            ))}
          </div>
        </RightPanel>
      </DashboardLayout>
      <BottomNav activeTab="" />
    </>
  );
}
