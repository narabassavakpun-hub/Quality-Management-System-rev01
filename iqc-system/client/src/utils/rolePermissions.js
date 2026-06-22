// qc_staff ที่ไม่ใช่สถานี incoming (QC รับเข้า) เห็นเฉพาะเมนูที่ไม่มี condition หรือ condition ผ่าน
const onlyReceivingQC = (user) => user.role !== 'qc_staff' || user.qc_station === 'incoming';

export const NAV_ITEMS = [
  { path: '/', label: 'หน้าหลัก', icon: 'home', roles: ['admin','qc_staff','qc_supervisor','qc_manager','qmr','purchasing','cco','cmo','cpo','production_manager'] },
  { path: '/bills', label: 'บิลรับเข้า', icon: 'receipt', roles: ['admin','qc_staff','qc_supervisor','qc_manager'], condition: onlyReceivingQC },
  { path: '/ncr', label: 'NCR/NCP Status', icon: 'alert', roles: ['admin','qc_staff','qc_supervisor','qc_manager','qmr','purchasing','cco','cmo','cpo','production_manager'], condition: onlyReceivingQC },
  { path: '/uai', label: 'UAI', icon: 'document', roles: ['admin','qc_manager','qmr','purchasing','cco','cmo','cpo','production_manager'] },
  { path: '/delivery', label: 'ปฏิทินส่งของ', mobileLabel: 'ปฏิทิน', icon: 'calendar', roles: ['admin','qc_staff','qc_supervisor','qc_manager','purchasing'], condition: onlyReceivingQC },
  { path: '/issue-talk', label: 'Issue Talk', mobileLabel: 'Issues', icon: 'chat', roles: ['admin','qc_staff','qc_supervisor','qc_manager','qmr','purchasing','cco','cmo','cpo','production_manager'], condition: onlyReceivingQC },
  { path: '/qc-attendance', label: 'เช็คชื่อ QC', mobileLabel: 'เช็คชื่อ', icon: 'checkin', roles: ['admin','qc_staff','qc_supervisor','qc_manager'] },
  { path: '/reports', label: 'รายงาน', icon: 'chart', roles: ['qc_manager','cco','cmo','cpo'] },
  {
    path: '/admin', label: 'จัดการระบบ', icon: 'shield', roles: ['admin'],
    children: [
      { path: '/admin/users',    label: 'ผู้ใช้งาน',  icon: 'users' },
      { path: '/admin/settings', label: 'ตั้งค่าระบบ', icon: 'settings' },
      { path: '/admin/holidays', label: 'วันหยุดบริษัท', icon: 'calendar' },
    ],
  },
  {
    path: '/master', label: 'Master List', icon: 'settings', roles: ['admin'],
    children: [
      { path: '/master/suppliers', label: 'ผู้ผลิต', icon: 'building' },
      { path: '/master/products', label: 'สินค้า', icon: 'box' },
      { path: '/master/product-groups', label: 'กลุ่มสินค้า', icon: 'folder' },
      { path: '/master/defect-categories', label: 'กลุ่มปัญหา', icon: 'tag' },
      { path: '/master/units', label: 'หน่วยนับ', icon: 'ruler' },
      { path: '/master/colors', label: 'สีสินค้า', icon: 'palette' },
    ],
  },
];

export function isReceivingQC(user) {
  return user?.role !== 'qc_staff' || user?.qc_station === 'incoming';
}

export function canAccess(path, userOrRole) {
  const user = typeof userOrRole === 'string' ? { role: userOrRole } : (userOrRole || {});
  const item = NAV_ITEMS.find(n => path.startsWith(n.path) && n.path !== '/');
  if (!item) return path === '/' ? true : false;
  if (!item.roles.includes(user.role)) return false;
  if (item.condition && !item.condition(user)) return false;
  return true;
}

export const STATUS_LABELS = {
  draft: { label: 'ร่าง', color: 'bg-gray-100 text-gray-700' },
  pending_approval: { label: 'รออนุมัติ', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'อนุมัติแล้ว', color: 'bg-green-100 text-green-800' },
  pending_supervisor: { label: 'รอหัวหน้า QC', color: 'bg-yellow-100 text-yellow-800' },
  pending_manager: { label: 'รอ QC Manager', color: 'bg-yellow-100 text-yellow-800' },
  pending_qmr_open: { label: 'รอ QMR เปิด', color: 'bg-orange-100 text-orange-800' },
  pending_purchasing_review: { label: 'รอจัดซื้อ Review', color: 'bg-cyan-100 text-cyan-800' },
  pending_supplier: { label: 'รอ Supplier', color: 'bg-blue-100 text-blue-800' },
  pending_manager_review: { label: 'รอ Manager ตรวจ', color: 'bg-yellow-100 text-yellow-800' },
  pending_supplier_resubmit: { label: 'ถูกส่งกลับ — รอ Supplier ตอบใหม่', color: 'bg-red-100 text-red-700' },
  pending_qmr_close: { label: 'รอ QMR ปิด', color: 'bg-orange-100 text-orange-800' },
  pending_uai: { label: 'รอดำเนินการ UAI', color: 'bg-violet-100 text-violet-800' },
  closed: { label: 'ปิดแล้ว', color: 'bg-green-100 text-green-800' },
  ncp_closed: { label: 'NCP ปิดแล้ว', color: 'bg-teal-100 text-teal-700' },
  uai_pending_qc_manager: { label: 'UAI รอ QC Manager', color: 'bg-purple-100 text-purple-800' },
  uai_pending_purchasing: { label: 'UAI รอจัดซื้อ', color: 'bg-purple-100 text-purple-800' },
  uai_pending_cco: { label: 'UAI รอ CCO', color: 'bg-purple-100 text-purple-800' },
  uai_pending_cmo: { label: 'UAI รอ CMO', color: 'bg-purple-100 text-purple-800' },
  uai_pending_cpo: { label: 'UAI รอ CPO', color: 'bg-purple-100 text-purple-800' },
  uai_pending_qc_ack: { label: 'UAI รอ QC รับทราบ', color: 'bg-purple-100 text-purple-800' },
  uai_pending_production_ack: { label: 'UAI รอผลิตรับทราบ', color: 'bg-purple-100 text-purple-800' },
  uai_pending_qmr_ack: { label: 'UAI รอ QMR รับทราบ', color: 'bg-purple-100 text-purple-800' },
  uai_completed: { label: 'UAI เสร็จสมบูรณ์', color: 'bg-green-100 text-green-800' },
  uai_rejected: { label: 'UAI ปฏิเสธ', color: 'bg-red-100 text-red-800' },
  uai_rejected_by_exec: { label: 'UAI ไม่อนุมัติโดย C-Level', color: 'bg-red-100 text-red-800' },
  passed: { label: 'ผ่าน', color: 'bg-green-100 text-green-800' },
  failed: { label: 'ไม่ผ่าน', color: 'bg-red-100 text-red-800' },
};
