import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';

// query keys ที่ต้อง invalidate ตาม link prefix
function keysFromLink(link, { includeNotifications = false } = {}) {
  const keys = includeNotifications
    ? [['notifications'], ['dashboard-stats']]
    : [['dashboard-stats']];

  if (!link) return keys;

  const parts = link.split('/');
  const segment = parts[1];
  const id = parts[2];

  if (segment === 'bills') {
    keys.push(['bills']);
    if (id) keys.push(['bill', id]);
  } else if (segment === 'ncr') {
    keys.push(['ncrs']);
    if (id) keys.push(['ncr', id]);
  } else if (segment === 'uai') {
    keys.push(['uais']);
    if (id) keys.push(['uai', id]);
  } else if (segment === 'issue-talk') {
    keys.push(['issue-talks']);
    keys.push(['issue-talk-unread']);
    if (id) keys.push(['issue-talk', id]);
  } else if (segment === 'delivery') {
    keys.push(['delivery']);
    if (id) keys.push(['delivery-detail', id]);
  }

  return keys;
}

export function useSSE() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const esRef = useRef(null);

  useEffect(() => {
    if (!user) return;

    function connect() {
      if (esRef.current) esRef.current.close();

      const es = new EventSource('/api/sse', { withCredentials: true });
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);

          if (payload.type === 'notification') {
            // รับเฉพาะ user นี้ — invalidate ทั้ง notification bell + entity
            keysFromLink(payload.link, { includeNotifications: true })
              .forEach(key => qc.invalidateQueries({ queryKey: key }));

          } else if (payload.type === 'status_change') {
            // Broadcast ถึงทุก user — invalidate เฉพาะ entity + dashboard ไม่แตะ notification bell
            keysFromLink(payload.link, { includeNotifications: false })
              .forEach(key => qc.invalidateQueries({ queryKey: key }));

          } else if (payload.type === 'attendance_update') {
            // Check-in/out broadcast — invalidate attendance queries ทุก user
            qc.invalidateQueries({ queryKey: ['qc-attendance-today'] });
            qc.invalidateQueries({ queryKey: ['attendance-my-status'] });
            if (payload.user_id) {
              qc.invalidateQueries({ queryKey: ['attendance-employee', payload.user_id] });
            }
          }
        } catch (_) {}
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [user?.id]);
}
