import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { timeAgo } from '../utils/time';

const NotificationContext = createContext(null);

// Seed notifications so the feed isn't empty on first login
function createSeedNotifications() {
  const now = Date.now();
  return [
    {
      id: 'seed_1',
      type: 'follow',
      actorId: 'u2',
      targetUsername: 'alex_t',
      text: 'started following you',
      createdAt: now - 2 * 60 * 1000, // 2m ago
      read: false,
    },
    {
      id: 'seed_2',
      type: 'comment',
      actorId: 'u3',
      postId: 'post_1',
      text: 'replied to your post',
      createdAt: now - 60 * 60 * 1000, // 1h ago
      read: false,
    },
    {
      id: 'seed_3',
      type: 'like',
      actorId: 'u4',
      postId: 'post_2',
      text: 'liked your post',
      createdAt: now - 3 * 60 * 60 * 1000, // 3h ago
      read: false,
    },
    {
      id: 'seed_4',
      type: 'community_join',
      actorId: 'u5',
      communityId: 'design',
      text: 'joined Design Thinkers',
      createdAt: now - 24 * 60 * 60 * 1000, // 1d ago
      read: true,
    },
    {
      id: 'seed_5',
      type: 'follow',
      actorId: 'u6',
      targetUsername: 'priya_designs',
      text: 'started following you',
      createdAt: now - 2 * 24 * 60 * 60 * 1000, // 2d ago
      read: true,
    },
    {
      id: 'seed_6',
      type: 'mention',
      subType: 'post',
      actorId: 'u2',
      postId: 'post_1',
      text: 'mentioned you in a post.',
      createdAt: now - 30 * 60 * 1000, // 30m ago
      read: false,
    },
  ];
}

export function NotificationProvider({ children }) {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('meetifyy_notifications');
      return saved ? JSON.parse(saved) : createSeedNotifications();
    } catch {
      return createSeedNotifications();
    }
  });

  // Persist notifications to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('meetifyy_notifications', JSON.stringify(notifications));
  }, [notifications]);

  const addNotification = useCallback((type, payload = {}) => {
    // Don't notify yourself
    if (payload.actorId && payload.actorId === currentUser?.id) return;

    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      subType: payload.subType || null,
      actorId: payload.actorId || currentUser?.id,
      targetUsername: payload.targetUsername || null,
      postId: payload.postId || null,
      communityId: payload.communityId || null,
      activityId: payload.activityId || null,
      convId: payload.convId || null,
      text: payload.text || '',
      createdAt: Date.now(),
      read: false,
    };

    setNotifications(prev => [notification, ...prev]);
  }, [currentUser]);

  const markAsRead = useCallback((id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const dismissNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const value = useMemo(() => ({
    notifications,
    addNotification,
    markAsRead,
    markAllRead,
    dismissNotification,
    clearAll,
    unreadCount,
    timeAgo,
  }), [notifications, addNotification, markAsRead, markAllRead, dismissNotification, clearAll, unreadCount]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
