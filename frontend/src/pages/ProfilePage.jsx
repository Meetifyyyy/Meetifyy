import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import ProfileHeader from '../components/profile/ProfileHeader';
import ProfileActivity from '../components/profile/ProfileActivity';
import UserListModal from '../components/common/UserListModal';
import profileStyles from './ProfilePage.module.css';

export default function ProfilePage() {
  const { profileUsername } = useParams();
  const navigate = useNavigate();
  const { username } = useAuth();
  
  const targetUsername = profileUsername || username;
  
  const [modalType, setModalType] = useState(null); // 'followers' or 'following'

  return (
    <>
      <main className={`centre ${profileStyles.profileMainContent} animate-in`}>
        <div className={profileStyles.profileSidebarFixed}>
          <ProfileHeader 
            profileUsername={targetUsername} 
            onViewFollowers={() => setModalType('followers')}
            onViewFollowing={() => setModalType('following')}
          />
        </div>
        
        <div className={profileStyles.profileContentScrollable}>
          <ProfileActivity profileUsername={targetUsername} />
        </div>
      </main>
      
      {modalType && (
        <UserListModal 
          type={modalType} 
          profileUsername={targetUsername} 
          onClose={() => setModalType(null)} 
        />
      )}
    </>
  );
}
