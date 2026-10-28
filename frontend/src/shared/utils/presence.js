export function canSeeOnlineStatus(currentUser, targetUser) {
  if (!targetUser) return false;
  if (currentUser && targetUser.username === currentUser.username) return true;

  // RULE: If current user hides their own status, they cannot see others'
  const currentUserPrefs = currentUser?.settings || currentUser?.preferences || {};
  if (currentUserPrefs.showOnlineStatus === false) {
    return false;
  }

  const prefs = targetUser.settings || targetUser.preferences || {};
  const showOnline = prefs.showOnlineStatus ?? true;
  if (!showOnline) return false;

  const whoCanSee = prefs.whoCanSeeOnline || 'everyone';
  if (whoCanSee === 'everyone') return true;
  if (whoCanSee === 'nobody') return false;

  const isFollowedByTarget = targetUser.followingList?.includes(currentUser?.username);
  if (whoCanSee === 'following') {
    return !!isFollowedByTarget;
  }
  
  if (whoCanSee === 'mutual') {
    const followsTarget = currentUser?.followingList?.includes(targetUser.username);
    return !!(isFollowedByTarget && followsTarget);
  }

  return true;
}

