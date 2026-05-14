import { useEffect, useRef } from 'react';
import { useCurrentUser } from './useCurrentUser';

interface WorkflowPollLog {
  _id: string;
  message?: string;
}

export function useBrowserNotification() {
  const { user } = useCurrentUser();
  const pollInterval = useRef<NodeJS.Timeout | null>(null);
  const browserNotificationEnabled =
    user?.enterpriseId?.automationConfig?.browserNotificationEnabled !== false;

  const requestPermission = async () => {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return false;
  };

  const showNotification = (title: string, body: string) => {
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
      });
    }
  };

  useEffect(() => {
    if (!user) return;

    const poll = async () => {
      try {
        const res = await fetch('/api/workflow-notification-logs/poll');
        const result = await res.json();
        const logs = Array.isArray(result.data) ? (result.data as WorkflowPollLog[]) : [];

        if (result.success && logs.length > 0) {
          if (browserNotificationEnabled) {
            await requestPermission();

            for (const log of logs) {
              showNotification('新任务提醒', log.message || '您有一项新的待办任务请及时处理');
            }
          }

          await fetch('/api/workflow-notification-logs/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: logs.map((log) => log._id) }),
          });
        }
      } catch (err) {
        console.error('[NotificationPoll] Error:', err);
      }
    };

    poll();
    pollInterval.current = setInterval(poll, 30000);

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [user, browserNotificationEnabled]);

  return { requestPermission };
}
