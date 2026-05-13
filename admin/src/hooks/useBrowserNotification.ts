import { useEffect, useRef } from 'react';
import { useCurrentUser } from './useCurrentUser';

export function useBrowserNotification() {
  const { user } = useCurrentUser();
  const pollInterval = useRef<NodeJS.Timeout | null>(null);

  const requestPermission = async () => {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    }
    return false;
  };

  const showNotification = (title: string, body: string) => {
    if (Notification.permission === "granted") {
      new Notification(title, {
        body,
        icon: '/favicon.ico', // Ensure icon exists or use a generic one
      });
    }
  };

  useEffect(() => {
    if (!user) return;

    // Start polling
    const poll = async () => {
      try {
        const res = await fetch('/api/workflow-notification-logs/poll');
        const result = await res.json();

        if (result.success && result.data && result.data.length > 0) {
          await requestPermission();
          
          for (const log of result.data) {
            showNotification('新任务提醒', log.message || '您有一项新的待办任务请及时处理');
          }

          // Mark as alerted
          await fetch('/api/workflow-notification-logs/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: result.data.map((l: any) => l._id) })
          });
        }
      } catch (err) {
        console.error('[NotificationPoll] Error:', err);
      }
    };

    // Initial check
    poll();

    // Set interval (every 30 seconds to be polite)
    pollInterval.current = setInterval(poll, 30000);

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [user]);

  return { requestPermission };
}
