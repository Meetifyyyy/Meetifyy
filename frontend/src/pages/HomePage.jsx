import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Background from '../components/common/Background';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import DashboardLayout from '../components/layout/DashboardLayout';
import RightPanel, { QuickActions, OnlineFriends, UpcomingEvents } from '../components/layout/RightPanel';
import Feed from '../components/feed/Feed';
import CommunitiesBrowse from '../components/communities/CommunitiesBrowse';
import CommunityView from '../components/communities/CommunityView';
import MessagesLayout from '../components/messages/MessagesLayout';
import BottomNav from '../components/layout/BottomNav';
import { communities } from '../data/communities';

export default function HomePage() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'home');

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);

  const [activeCommunity, setActiveCommunity] = useState(null);

  const handleTabChange = (tab) => {
    setActiveCommunity(null);
    setActiveTab(tab);
  };

  const handleOpenCommunity = (id) => {
    setActiveCommunity(id);
    setActiveTab('community-detail');
  };

  const handleBackFromCommunity = () => {
    setActiveCommunity(null);
    setActiveTab('communities');
  };

  const isWide = activeTab === 'communities' || activeTab === 'messages';

  const quickActions = [
    {
      label: 'New Meeting',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    },
    {
      label: 'Add Friend',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
    },
    {
      label: 'Send Message',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
    },
  ];

  const renderCentre = () => {
    if (activeTab === 'community-detail' && activeCommunity) {
      return (
        <main className="centre">
          <CommunityView communityId={activeCommunity} onBack={handleBackFromCommunity} />
        </main>
      );
    }
    if (activeTab === 'communities') {
      return (
        <main className="centre centre-wide">
          <CommunitiesBrowse onOpenCommunity={handleOpenCommunity} />
        </main>
      );
    }
    if (activeTab === 'messages') {
      return (
        <main className="centre centre-wide centre--messages">
          <MessagesLayout />
        </main>
      );
    }
    return (
      <main className="centre">
        <Feed />
      </main>
    );
  };

  const renderRightPanel = () => {
    if (isWide) return null;

    if (activeTab === 'community-detail' && activeCommunity) {
      const comm = communities[activeCommunity];
      if (!comm) return null;
      return (
        <RightPanel>
          <div className="panel-card">
            <h3 className="panel-title">{comm.name}</h3>
            <div className="comm-stat">
              <div className="comm-stat-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div><strong>{comm.members.toLocaleString()}</strong> total members</div>
            </div>
            <div className="comm-stat">
              <div className="comm-stat-icon" style={{ color: '#22C55E' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div><strong>{comm.online}</strong> online now</div>
            </div>
            <div className="comm-stat">
              <div className="comm-stat-icon" style={{ color: '#A855F7' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div>Created {comm.created}</div>
            </div>
          </div>
        </RightPanel>
      );
    }

    return (
      <RightPanel>
        <QuickActions actions={quickActions} />
        <OnlineFriends />
        <UpcomingEvents />
      </RightPanel>
    );
  };

  return (
    <>
      <Background />
      <Header variant="dashboard" activeTab={activeTab} />
      <DashboardLayout wide={isWide}>
        <Sidebar
          activeTab={activeTab === 'community-detail' ? 'communities' : activeTab}
          onTabChange={handleTabChange}
          onCommunityClick={handleOpenCommunity}
        />
        {renderCentre()}
        {renderRightPanel()}
      </DashboardLayout>
      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
    </>
  );
}
