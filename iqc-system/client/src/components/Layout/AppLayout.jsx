import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../hooks/useNotifications';
import { useSSE } from '../../hooks/useSSE';
import { useIdleTimeout } from '../../hooks/useIdleTimeout';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bellOpen, setBellOpen] = useState(false);
  const [idleWarn, setIdleWarn] = useState(false);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  useSSE();
  const bellRef = useRef(null);

  // DEVMORE H6 / CLAUDE.md 3.1 — idle 30 นาที logout, เตือนก่อน 2 นาที
  const handleWarn = useCallback(() => setIdleWarn(true), []);
  const handleTimeout = useCallback(() => { setIdleWarn(false); logout(); }, [logout]);
  useIdleTimeout({ onWarn: handleWarn, onTimeout: handleTimeout, enabled: !!user });

  useEffect(() => {
    function handler(e) { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleNotifClick(n) {
    markRead.mutate(n.id);
    setBellOpen(false);
    navigate(n.link);
  }

  // Admin dashboard fills 100vh with its own header+bell
  if (user?.role === 'admin' && location.pathname === '/') {
    return (
      <>
        <main className="h-screen overflow-hidden">
          <Outlet />
        </main>
        {idleWarn && (
          <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4">
            <div className="bg-surface rounded-lg shadow-xl max-w-sm w-full p-5 text-center">
              <div className="text-h3 font-bold text-warning mb-2">ใกล้ออกจากระบบอัตโนมัติ</div>
              <p className="text-body text-muted mb-4">คุณไม่มีการใช้งานเป็นเวลานาน ระบบจะออกจากระบบอัตโนมัติภายในไม่กี่นาที</p>
              <button onClick={() => setIdleWarn(false)} className="w-full min-h-[44px] bg-primary text-white rounded-md font-medium hover:opacity-90">
                ยังอยู่ในระบบ
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — hidden on mobile */}
      <div className="hidden lg:flex flex-shrink-0 h-full">
        <Sidebar collapsed={!sidebarOpen} onToggle={() => setSidebarOpen(p => !p)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="bg-surface border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(p => !p)}
            className="hidden lg:flex items-center justify-center w-10 h-10 rounded-md hover:bg-bg text-muted"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="lg:hidden text-primary font-bold text-h3">IQC</div>
          <div className="flex-1" />

          {/* Bell */}
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => setBellOpen(p => !p)}
              className="relative w-10 h-10 flex items-center justify-center rounded-md hover:bg-bg text-muted"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="font-semibold text-body text-primary">การแจ้งเตือน</span>
                  {unreadCount > 0 && (
                    <button onClick={() => markAllRead.mutate()} className="text-small text-accent hover:underline">อ่านทั้งหมด</button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 && (
                    <div className="px-4 py-6 text-center text-muted text-small">ไม่มีการแจ้งเตือน</div>
                  )}
                  {notifications.slice(0, 20).map(n => (
                    <button
                      key={n.id}
                      onClick={() => handleNotifClick(n)}
                      className={`w-full text-left px-3 py-3 hover:bg-bg border-b border-border last:border-0 ${!n.is_read ? 'bg-blue-50' : ''}`}
                    >
                      <div className="text-body font-medium text-text">{n.title}</div>
                      <div className="text-small text-muted mt-0.5">{n.message}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="text-small text-muted hidden sm:block">{user?.full_name}</div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 pb-20 lg:pb-4">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <div className="lg:hidden">
        <BottomNav />
      </div>

      {/* DEVMORE H6 — Idle warning ก่อน auto-logout */}
      {idleWarn && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-surface rounded-lg shadow-xl max-w-sm w-full p-5 text-center">
            <div className="text-h3 font-bold text-warning mb-2">ใกล้ออกจากระบบอัตโนมัติ</div>
            <p className="text-body text-muted mb-4">
              คุณไม่มีการใช้งานเป็นเวลานาน ระบบจะออกจากระบบอัตโนมัติภายในไม่กี่นาที
            </p>
            <button
              onClick={() => setIdleWarn(false)}
              className="w-full min-h-[44px] bg-primary text-white rounded-md font-medium hover:opacity-90"
            >
              ยังอยู่ในระบบ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
