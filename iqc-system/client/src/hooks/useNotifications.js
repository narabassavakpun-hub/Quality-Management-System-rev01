import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

export function useNotifications() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: notifResult = {} } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    enabled: !!user,
    refetchInterval: 30000,
  });

  const notifications = Array.isArray(notifResult) ? notifResult : (notifResult.data ?? []);
  const unreadCount = typeof notifResult.unread === 'number' ? notifResult.unread : notifications.filter(n => !n.is_read).length;

  const markRead = useMutation({
    mutationFn: (id) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries(['notifications']),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries(['notifications']),
  });

  return { notifications, unreadCount, markRead, markAllRead };
}
