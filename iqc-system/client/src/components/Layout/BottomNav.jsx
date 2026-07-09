import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { NAV_ITEMS, matchesChild } from '../../utils/rolePermissions';
import api from '../../utils/api';

const ICONS_SVG = {
  home: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  receipt: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
  alert: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
  document: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>,
  calendar: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  chart: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  shield: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  settings: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  chat: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  checkin: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
  kpi: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  inbox: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>,
  factory: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M4 21V10l5 3V10l5 3V8l5 3v10M9 21v-4h2v4" /></svg>,
  clipboard: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
  more: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" /></svg>,
};

export default function BottomNav() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [showMore, setShowMore] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null); // bottom-sheet สำหรับ group items ในแถบหลัก

  function closeAll() { setShowMore(false); setExpandedGroup(null); setActiveGroup(null); }
  const visibleItems = NAV_ITEMS.filter(item =>
    item.roles.includes(user?.role) && (!item.condition || item.condition(user))
  );

  // Admin mobile: หน้าหลัก, Master List, จัดการระบบ, Issue Talk อยู่ในแถบหลัก
  let orderedItems = visibleItems;
  if (user?.role === 'admin') {
    const adminMain = ['/', '/master', '/admin', '/issue-talk'];
    const priority = adminMain.map(p => visibleItems.find(i => i.path === p)).filter(Boolean);
    const rest = visibleItems.filter(i => !adminMain.includes(i.path));
    orderedItems = [...priority, ...rest];
  }

  const mainItems = orderedItems.slice(0, 4);
  const moreItems = orderedItems.slice(4);

  const { data: unreadData } = useQuery({
    queryKey: ['issue-talk-unread'],
    queryFn: () => api.get('/issue-talk/unread-total').then(r => r.data),
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const issueTalkUnread = unreadData?.total ?? 0;
  const issueTalkInMore = moreItems.some(item => item.path === '/issue-talk');

  // หา group ที่กำลัง active อยู่ (สำหรับ bottom sheet)
  const activeGroupItem = activeGroup ? orderedItems.find(i => i.path === activeGroup) : null;

  return (
    <>
      {/* ── "เพิ่มเติม" drawer ── */}
      {showMore && (
        <div className="fixed inset-0 z-40" onClick={() => { setShowMore(false); setExpandedGroup(null); }}>
          <div className="absolute bottom-14 left-0 right-0 bg-surface border-t border-border shadow-lg max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {moreItems.map(item => {
              if (!item.children) {
                return (
                  <NavLink key={item.path} to={item.path}
                    onClick={closeAll}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-bg text-text min-h-[48px]">
                    <span className="flex-1">{item.label}</span>
                    {item.path === '/issue-talk' && issueTalkUnread > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white font-bold leading-none" style={{ fontSize: '10px' }}>
                        {issueTalkUnread > 99 ? '99+' : issueTalkUnread}
                      </span>
                    )}
                  </NavLink>
                );
              }
              const isExpanded = expandedGroup === item.path;
              return (
                <div key={item.path}>
                  <button
                    onClick={() => setExpandedGroup(isExpanded ? null : item.path)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-bg text-text w-full text-left min-h-[48px]">
                    <span className="flex-1">{item.label}</span>
                    <svg className={`w-4 h-4 text-muted flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="border-l-2 border-border ml-4 bg-bg">
                      {item.children
                        .filter(child => (!child.roles || child.roles.includes(user?.role)) && (!child.condition || child.condition(user)))
                        .map(child => (
                        <NavLink key={child.path} to={child.path}
                          onClick={closeAll}
                          className={({ isActive }) =>
                            `flex items-center gap-3 pl-4 pr-3 py-3 min-h-[48px] text-body ${isActive ? 'text-primary font-medium' : 'text-text hover:text-primary'}`
                          }>
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={() => { closeAll(); logout(); }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-bg text-danger w-full min-h-[48px]">
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom sheet สำหรับ group items ในแถบหลัก ── */}
      {activeGroupItem && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setActiveGroup(null)} />
          {/* Sheet */}
          <div className="fixed bottom-14 left-0 right-0 z-50 bg-surface rounded-t-2xl shadow-2xl overflow-hidden"
            style={{ maxHeight: '60vh' }}>
            {/* Handle + title */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border">
              <span className="font-semibold text-body text-primary">{activeGroupItem.label}</span>
              <button onClick={() => setActiveGroup(null)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted rounded-full hover:bg-bg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Children */}
            <div className="overflow-y-auto">
              {activeGroupItem.children
                .filter(child => (!child.roles || child.roles.includes(user?.role)) && (!child.condition || child.condition(user)))
                .map(child => {
                const isActive = matchesChild(location.pathname, child);
                return (
                  <NavLink
                    key={child.path}
                    to={child.path}
                    onClick={() => setActiveGroup(null)}
                    className={`flex items-center gap-3 px-5 min-h-[52px] border-b border-border last:border-0 text-body
                      ${isActive ? 'text-primary font-semibold bg-blue-50 dark:bg-blue-900' : 'text-text hover:bg-bg'}`}
                  >
                    {isActive && (
                      <svg className="w-4 h-4 flex-shrink-0 text-primary" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                      </svg>
                    )}
                    <span>{child.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Nav bar ── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border z-30 flex">
        {mainItems.map(item => {
          // Group item → เปิด bottom sheet
          if (item.children) {
            const isChildActive = item.children.some(c => matchesChild(location.pathname, c));
            const isSheetOpen = activeGroup === item.path;
            return (
              <button
                key={item.path}
                onClick={() => { setShowMore(false); setActiveGroup(isSheetOpen ? null : item.path); }}
                className={`flex-1 flex flex-col items-center py-2 gap-0.5 min-h-[56px]
                  ${isChildActive || isSheetOpen ? 'text-primary' : 'text-muted'}`}
              >
                {ICONS_SVG[item.icon]}
                <span className="text-[10px]">{item.mobileLabel || item.label}</span>
              </button>
            );
          }
          // Regular item → NavLink
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => setActiveGroup(null)}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2 gap-0.5 min-h-[56px] ${isActive ? 'text-primary' : 'text-muted'}`
              }
            >
              <div className="relative">
                {ICONS_SVG[item.icon]}
                {item.path === '/issue-talk' && issueTalkUnread > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-danger text-white font-bold leading-none" style={{ fontSize: '9px' }}>
                    {issueTalkUnread > 99 ? '99+' : issueTalkUnread}
                  </span>
                )}
              </div>
              <span className="text-[10px]">{item.mobileLabel || item.label}</span>
            </NavLink>
          );
        })}
        {(moreItems.length > 0 || true) && (
          <button onClick={() => { setActiveGroup(null); setShowMore(p => !p); }}
            className="flex-1 flex flex-col items-center py-2 gap-0.5 min-h-[56px] text-muted">
            <div className="relative">
              {ICONS_SVG.more}
              {issueTalkInMore && issueTalkUnread > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-danger" />
              )}
            </div>
            <span className="text-[10px]">เพิ่มเติม</span>
          </button>
        )}
      </nav>
    </>
  );
}
