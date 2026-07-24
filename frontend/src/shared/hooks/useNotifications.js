import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../api/apiClient';

export function useNotifications() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam = undefined }) => notificationsApi.getAll(20, pageParam),
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    staleTime: 1000 * 60, // 1 minute
  });

  const { data: unreadCountData } = useQuery({
    queryKey: ['notifications', 'unreadCount'],
    queryFn: () => notificationsApi.getUnreadCount(),
    staleTime: 1000 * 30, // 30 seconds
  });

  const markAsReadMutation = useMutation({
    mutationFn: (id) => notificationsApi.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['notifications', 'unreadCount']);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['notifications', 'unreadCount']);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => notificationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['notifications', 'unreadCount']);
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
