import { createContext, useContext } from 'react';
import { useData } from './DataContext';

const FollowContext = createContext(null);

export function FollowProvider({ children }) {
  const { currentUser, toggleFollow: dataToggleFollow } = useData();

  const following = currentUser?.followingList || [];

  const isFollowing = (uName) => {
    return following.includes(uName);
  };

  const toggleFollow = (uName) => {
    dataToggleFollow(uName);
  };

  return (
    <FollowContext.Provider value={{ following, isFollowing, toggleFollow }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow() {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error('useFollow must be used within FollowProvider');
  return ctx;
}
