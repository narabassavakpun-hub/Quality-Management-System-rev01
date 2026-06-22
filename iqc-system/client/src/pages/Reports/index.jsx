import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const REPORT_MENU = [
  { path: 'summary', label: 'ภาพรวม' },
  { path: 'receiving', label: 'การรับเข้า' },
  { path: 'ncr', label: 'NCR' },
  { path: 'uai', label: 'UAI' },
];

export default function ReportsLayout() {
  return (
    <div className="space-y-4">
      <h1 className="page-title">รายงาน</h1>
      <div className="flex gap-1 flex-wrap border-b border-border pb-2">
        {REPORT_MENU.map(m => (
          <NavLink
            key={m.path}
            to={m.path}
            className={({ isActive }) =>
              `px-3 py-2 text-body rounded-t-md min-h-[40px] ${isActive ? 'bg-primary text-white' : 'text-muted hover:text-text hover:bg-bg'}`
            }
          >
            {m.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
