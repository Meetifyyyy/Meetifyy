import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../api/apiClient';

import { useAuth } from '../context/AuthContext';

export function useNotifications() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam = undefined }) => notificationsApi.getAll(15, pageParam),
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    enabled: Boolean(currentUser?.id),
    staleTime: 1000 * 60, // 1 minute
  });

  const { data: unreadCountData } = useQuery({
    queryKey: ['notifications', 'unreadCount'],
    queryFn: () => notificationsApi.getUnreadCount(),
    // M-3 fix: Disabled HTTP polling by setting staleTime to Infinity.
    // The unread count is already pushed via real-time WebSocket/SW events.
    staleTime: Infinity,
  });

  const markAsReadMutation = useMutation({
    mutationFn: (id) => notificationsApi.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unreadCount'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unreadCount'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => notificationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unreadCount'] });
    },
  });

  const allNotifications = data?.pages.flatMap(page => page.data || []) ?? [];

  return {
    notifications: allNotifications,
    unreadCount: unreadCountData?.count || 0,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    markAsRead: (id) => markAsReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
    dismissNotification: (id) => deleteMutation.mutate(id),
  };
}
