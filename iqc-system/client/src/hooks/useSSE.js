import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';

// query keys ที่ต้อง invalidate ตาม link prefix
function keysFromLink(link, { includeNotifications = false } = {}) {
  const keys = includeNotifications
    ? [['notifications'], ['dashboard-stats']]
    : [['dashboard-stats']];

  if (!link) return keys;

  // ตัด query string ออกก่อน (เช่น "/delivery?schedule=123") — ไม่งั้น segment จะกลาย
  // เป็น "delivery?schedule=123" ทั้งท่อน ไม่ตรงกับ === 'delivery' เลยข้าม invalidate ไปเฉยๆ
  const [pathOnly] = link.split('?');
  const parts = pathOnly.split('/');
  const segment = parts[1];
  const id = parts[2];

  if (segment === 'bills') {
    keys.push(['bills']);
    if (id) keys.push(['bill', id]);
  } else if (segment === 'ncr') {
    keys.push(['ncrs']);
    if (id) keys.push(['ncr', id]);
    // Purchasing Dashboard (PurchasingDash.jsx) รวมข้อมูลจาก ncrs ล้วนๆ (join bills/suppliers) — ทุก
    // status change ของ NCR (เช่น QMR อนุมัติเปิด NCR: pending_qmr_open → pending_purchasing_review)
    // ต้อง invalidate query ของ dashboard นี้ด้วย ไม่งั้นตัวเลข/รายการค้างจนกว่าจะรีเฟรชหน้าเอง
    keys.push(['purchasing-dashboard-summary']);
    keys.push(['purchasing-dashboard-suppliers']);
    keys.push(['purchasing-dashboard-suppliers-all']);
    keys.push(['purchasing-dashboard-ncrs']);
  } else if (segment === 'uai') {
    keys.push(['uais']);
    if (id) keys.push(['uai', id]);
    // UAI status ผูกกับ ncrs.status ด้วย (เช่น uai_pending_qc_manager) — กระทบ bucket ใน Purchasing
    // Dashboard เหมือนกัน
    keys.push(['purchasing-dashboard-summary']);
    keys.push(['purchasing-dashboard-suppliers']);
    keys.push(['purchasing-dashboard-suppliers-all']);
    keys.push(['purchasing-dashboard-ncrs']);
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
