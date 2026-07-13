export function canSeeOnlineStatus(currentUser, targetUser) {
  if (!targetUser) return false;
  if (currentUser && targetUser.username === currentUser.username) return true;

  const prefs = targetUser.preferences || {};
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

export function canSeeLastSeen(currentUser, targetUser) {
  if (!targetUser) return false;
  if (currentUser && targetUser.username === currentUser.username) return true;

  const prefs = targetUser.preferences || {};
  const showLastSeen = prefs.showLastSeen ?? true;
  if (!showLastSeen) return false;

  const whoCanSee = prefs.whoCanSeeLastSeen || 'everyone';
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

export function formatLastSeen(timestamp) {
  if (!timestamp) return 'recently';
  const now = Date.now();
  const date = new Date(timestamp);
  const diffMs = now - date.getTime();
  
  if (diffMs < 0) return 'just now';
  
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  
  const yesterday = new Date(now - 86400000);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'yesterday';
  }
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays <= 1) return 'yesterday';
  return `${diffDays} days ago`;
}
