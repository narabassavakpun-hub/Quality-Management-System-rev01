import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { NAV_ITEMS } from '../../utils/rolePermissions';
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
  more: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" /></svg>,
};

export default function BottomNav() {
  const { user, logout } = useAuth();
  const [showMore, setShowMore] = useState(false);
  const visibleItems = NAV_ITEMS.filter(item =>
    item.roles.includes(user?.role) && (!item.condition || item.condition(user))
  );
  const mainItems = visibleItems.slice(0, 4);
  const moreItems = visibleItems.slice(4);

  const { data: unreadData } = useQuery({
    queryKey: ['issue-talk-unread'],
    queryFn: () => api.get('/issue-talk/unread-total').then(r => r.data),
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const issueTalkUnread = unreadData?.total ?? 0;
  const issueTalkInMore = moreItems.some(item => item.path === '/issue-talk');

  return (
    <>
      {showMore && (
        <div className="fixed inset-0 z-40" onClick={() => setShowMore(false)}>
          <div className="absolute bottom-16 left-0 right-0 bg-surface border-t border-border shadow-lg" onClick={e => e.stopPropagation()}>
            {moreItems.map(item => (
              <NavLink key={item.path} to={item.path} onClick={() => setShowMore(false)} className="flex items-center gap-3 px-4 py-3 hover:bg-bg text-text min-h-[48px]">
                <span className="flex-1">{item.label}</span>
                {item.path === '/issue-talk' && issueTalkUnread > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white font-bold leading-none" style={{ fontSize: '10px' }}>
                    {issueTalkUnread > 99 ? '99+' : issueTalkUnread}
                  </span>
                )}
              </NavLink>
            ))}
            <button onClick={() => { setShowMore(false); logout(); }} className="flex items-center gap-3 px-4 py-3 hover:bg-bg text-danger w-full min-h-[48px]">
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}
      <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border z-30 flex">
        {mainItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
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
        ))}
        {(moreItems.length > 0 || true) && (
          <button onClick={() => setShowMore(p => !p)} className="flex-1 flex flex-col items-center py-2 gap-0.5 min-h-[56px] text-muted">
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
