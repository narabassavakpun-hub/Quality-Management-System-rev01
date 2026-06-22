import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { NAV_ITEMS } from '../../utils/rolePermissions';
import api from '../../utils/api';
import Modal from '../UI/Modal';
import Button from '../UI/Button';

const Icons = {
  home:     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  receipt:  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
  alert:    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
  document: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>,
  chart:    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  settings: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  building: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  box:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>,
  folder:   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>,
  tag:      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>,
  ruler:    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 3m0 0l3-3M6 9V3M21 18l-3-3m0 0l-3 3m3-3v6M3 18h18" /></svg>,
  palette:  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v.586l1.707 1.707A1 1 0 0013 8h3a2 2 0 012 2v6a2 2 0 01-2 2h-1.172a1 1 0 00-.707.293L12 20.414A4 4 0 017 21z" /></svg>,
  shield:   <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  calendar: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  chat:     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  checkin:  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
  users:    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  chevron:  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>,
};

function ChangePasswordModal({ open, onClose }) {
  const [form, setForm]       = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  function reset() {
    setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setError('');
    setDone(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.newPassword.length < 8) {
      setError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() { reset(); onClose(); }

  const mismatch = form.confirmPassword.length > 0 && form.newPassword !== form.confirmPassword;

  return (
    <Modal open={open} onClose={handleClose} title="เปลี่ยนรหัสผ่าน">
      {done ? (
        <div className="text-center space-y-4 py-2">
          <p className="text-success font-medium">เปลี่ยนรหัสผ่านสำเร็จ</p>
          <Button onClick={handleClose}>ปิด</Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <div className="text-danger text-small">{error}</div>}
          <div>
            <label className="label">รหัสผ่านปัจจุบัน *</label>
            <input
              type="password"
              className="input"
              value={form.currentPassword}
              onChange={e => setForm(p => ({ ...p, currentPassword: e.target.value }))}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">รหัสผ่านใหม่ * (อย่างน้อย 8 ตัว)</label>
            <input
              type="password"
              className="input"
              value={form.newPassword}
              onChange={e => setForm(p => ({ ...p, newPassword: e.target.value }))}
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="label">ยืนยันรหัสผ่านใหม่ *</label>
            <input
              type="password"
              className={`input ${mismatch ? 'border-danger focus:ring-danger' : ''}`}
              value={form.confirmPassword}
              onChange={e => setForm(p => ({ ...p, confirmPassword: e.target.value }))}
              required
            />
            {mismatch && <p className="text-danger text-[11px] mt-0.5">รหัสผ่านไม่ตรงกัน</p>}
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" loading={loading} disabled={mismatch}>บันทึก</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function IssueTalkBadge({ count }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white font-bold leading-none flex-shrink-0" style={{ fontSize: '10px' }}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function Sidebar({ collapsed, onToggle }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [changePwOpen, setChangePwOpen] = useState(false);
  const visibleItems = NAV_ITEMS.filter(item =>
    item.roles.includes(user?.role) && (!item.condition || item.condition(user))
  );

  const { data: unreadData } = useQuery({
    queryKey: ['issue-talk-unread'],
    queryFn: () => api.get('/issue-talk/unread-total').then(r => r.data),
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const issueTalkUnread = unreadData?.total ?? 0;

  // auto-expand groups that contain the current path
  const defaultOpen = new Set(
    visibleItems
      .filter(item => item.children?.some(c => location.pathname.startsWith(c.path)))
      .map(item => item.path)
  );
  const [openGroups, setOpenGroups] = useState(defaultOpen);

  useEffect(() => {
    visibleItems.forEach(item => {
      if (item.children?.some(c => location.pathname.startsWith(c.path))) {
        setOpenGroups(prev => new Set([...prev, item.path]));
      }
    });
  }, [location.pathname]);

  function toggleGroup(path) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  return (
    <aside className={`bg-primary flex flex-col h-full transition-all duration-200 ${collapsed ? 'w-0 overflow-hidden' : 'w-60'}`}>
      <div className="px-4 py-4 border-b border-white/10">
        <div className="text-white font-bold text-h3">IQC System</div>
        <div className="text-white/60 text-small mt-0.5">{user?.full_name}</div>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {visibleItems.map(item => {
          if (!item.children) {
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 text-body transition-colors min-h-[48px] ${isActive ? 'bg-white/20 text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'}`
                }
              >
                {Icons[item.icon]}
                <span className="flex-1">{item.label}</span>
                {item.path === '/issue-talk' && <IssueTalkBadge count={issueTalkUnread} />}
              </NavLink>
            );
          }

          // Group with children
          const isGroupOpen = openGroups.has(item.path);
          const isGroupActive = item.children.some(c => location.pathname.startsWith(c.path));

          return (
            <div key={item.path}>
              <button
                onClick={() => toggleGroup(item.path)}
                className={`flex items-center gap-3 px-4 py-3 text-body transition-colors min-h-[48px] w-full text-left ${isGroupActive ? 'text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                {Icons[item.icon]}
                <span className="flex-1">{item.label}</span>
                <span className={`transition-transform duration-200 ${isGroupOpen ? 'rotate-180' : ''}`}>
                  {Icons.chevron}
                </span>
              </button>

              {isGroupOpen && (
                <div className="bg-black/20 border-l-2 border-white/20 ml-4">
                  {item.children.map(child => (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      className={({ isActive }) =>
                        `flex items-center gap-2 pl-4 pr-3 py-2.5 text-small transition-colors min-h-[40px] ${isActive ? 'bg-white/20 text-white font-medium' : 'text-white/60 hover:bg-white/10 hover:text-white'}`
                      }
                    >
                      {Icons[child.icon]}
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-2 border-t border-white/10 space-y-0.5">
        <button
          onClick={() => setChangePwOpen(true)}
          className="flex items-center gap-2 text-white/70 hover:text-white text-small w-full min-h-[44px]"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          เปลี่ยนรหัสผ่าน
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-white/70 hover:text-white text-small w-full min-h-[44px]"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          ออกจากระบบ
        </button>
      </div>

      <ChangePasswordModal open={changePwOpen} onClose={() => setChangePwOpen(false)} />
    </aside>
  );
}
