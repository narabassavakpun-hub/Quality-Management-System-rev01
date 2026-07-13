// qc_staff ที่ไม่ใช่สถานี incoming (QC รับเข้า) เห็นเฉพาะเมนูที่ไม่มี condition หรือ condition ผ่าน
const onlyReceivingQC = (user) => user.role !== 'qc_staff' || user.qc_station === 'incoming';

const ALL_QC_ROLES = ['admin','qc_staff','qc_supervisor','qc_manager','qmr','purchasing','purchasing_manager','cco','cmo','cpo','production_manager','prod_supervisor'];
const PROD_QC_ROLES = ['admin','qc_staff','qc_supervisor','qc_manager','cpo','production_manager','prod_supervisor'];

// ป้าย role ภาษาไทย — จุดรวมเดียว (แก้ CLAUDE.md §12/AUDIT.md Q5 drift ที่เคยกระจายซ้ำใน Admin/Users.jsx + UAI/Detail.jsx)
export const ROLE_LABELS = {
  admin: 'ผู้ดูแลระบบ',
  qc_staff: 'QC Staff',
  qc_supervisor: 'QC Supervisor',
  qc_manager: 'QC Manager',
  qmr: 'QMR',
  purchasing: 'จัดซื้อ',
  purchasing_manager: 'ผู้จัดการจัดซื้อ',
  cco: 'CCO',
  cmo: 'CMO',
  cpo: 'CPO',
  production_manager: 'ผู้จัดการฝ่ายผลิต',
  prod_supervisor: 'หัวหน้างานผลิต',
};

// role ที่สร้าง user ได้จริงผ่าน Admin/Users.jsx — ตรงกับ schema CHECK ปัจจุบัน (11 roles รวม prod_supervisor)
// เดิม (Session 103) คิดว่า schema รองรับแค่ 10 roles (ตาม AUDIT.md D1 เดิม) จึงตัด prod_supervisor ออก —
// ตรวจสอบซ้ำแล้ว (Session 105) พบว่า schema.sql + migrateUsersRoleConstraint() รองรับ prod_supervisor อยู่แล้วจริง
// (ยืนยันด้วย INSERT ทดสอบสำเร็จ) ปิด role drift D1 แล้ว — ดู AUDIT.md D1
export const CREATABLE_ROLES = Object.entries(ROLE_LABELS)
  .map(([value, label]) => ({ value, label }));

export const NAV_ITEMS = [
  { path: '/', label: 'หน้าหลัก', icon: 'home', roles: ALL_QC_ROLES },
  {
    path: '/iqc', label: 'ส่วนงานรับเข้า (IQC)', mobileLabel: 'IQC', icon: 'inbox',
    roles: ALL_QC_ROLES,
    condition: onlyReceivingQC,
    children: [
      { path: '/bills',    label: 'บิลรับเข้า',    icon: 'receipt',  roles: ['admin','qc_staff','qc_supervisor','qc_manager'], condition: onlyReceivingQC },
      { path: '/ncr',     label: 'NCR/NCP',        icon: 'alert',    roles: ['admin','qc_staff','qc_supervisor','qc_manager','qmr','purchasing','purchasing_manager','cco','cmo','cpo','production_manager'], condition: onlyReceivingQC },
      { path: '/uai',     label: 'UAI',            icon: 'document', roles: ['admin','qc_manager','qmr','purchasing','purchasing_manager','cco','cmo','cpo','production_manager'] },
      { path: '/delivery', label: 'ปฏิทินส่งของ', icon: 'calendar', roles: ['admin','qc_staff','qc_supervisor','qc_manager','purchasing','purchasing_manager'], condition: onlyReceivingQC },
      { path: '/fg-production/material-defects', label: 'ของเสียวัตถุดิบ', icon: 'alert', roles: ['admin','qc_staff','qc_supervisor','qc_manager'], condition: onlyReceivingQC },
    ],
  },
  {
    path: '/production-qc', label: 'QC หน้างาน', mobileLabel: 'QC งาน', icon: 'factory',
    roles: PROD_QC_ROLES,
    children: [
      { path: '/production-qc/dashboard', label: 'Dashboard',          icon: 'grid',      roles: PROD_QC_ROLES },
      { path: '/production-qc/ipqc',     label: 'บันทึก IPQC',        icon: 'clipboard', roles: PROD_QC_ROLES },
      { path: '/production-qc/ipncr',    label: 'IPNCR',               icon: 'alert',     roles: PROD_QC_ROLES },
      { path: '/fg-production',          label: 'บันทึกยอดผลิต/ของเสีย (FG)', icon: 'plus',   roles: PROD_QC_ROLES, end: true },
      { path: '/fg-production/fncp',    label: 'FNCP',                         icon: 'alert',  roles: PROD_QC_ROLES },
      { path: '/fg-production/fuai',    label: 'FUAI',                         icon: 'shield', roles: PROD_QC_ROLES },
    ],
  },
  { path: '/issue-talk', label: 'Issue Talk', mobileLabel: 'Issues', icon: 'chat', roles: ['admin','qc_staff','qc_supervisor','qc_manager','qmr','purchasing','cco','cmo','cpo','production_manager'], condition: onlyReceivingQC },
  { path: '/qc-attendance', label: 'เช็คชื่อ QC', mobileLabel: 'เช็คชื่อ', icon: 'checkin', roles: ['admin','qc_staff','qc_supervisor','qc_manager'] },
  { path: '/reports', label: 'รายงาน', icon: 'chart', roles: ['qc_manager','cco','cmo','cpo'] },
  {
    path: '/kpi', label: 'KPI', icon: 'kpi', roles: ['admin', 'qc_manager', 'cpo', 'qmr'],
    children: [
      { path: '/kpi/dashboard', label: 'Dashboard',  icon: 'grid' },
      { path: '/kpi/summary',   label: 'สรุป KPI',   icon: 'pie' },
      { path: '/kpi/bantuk',    label: 'บันทึก KPI', icon: 'pencil' },
      { path: '/kpi/setup',     label: 'Setup',      icon: 'settings', roles: ['admin'] },
    ],
  },
  {
    path: '/admin', label: 'จัดการระบบ', icon: 'shield', roles: ['admin'],
    children: [
      { path: '/admin/users',      label: 'ผู้ใช้งาน',     icon: 'users' },
      { path: '/admin/settings',   label: 'ตั้งค่าระบบ',   icon: 'settings' },
      { path: '/admin/production-master', label: 'Master หน้างาน', icon: 'factory' },
      { path: '/admin/procode-sap', label: 'ProCodeSAP & PDPlan', icon: 'box' },
      { path: '/admin/holidays',   label: 'วันหยุดบริษัท', icon: 'calendar' },
      { path: '/admin/audit-logs', label: 'Log การใช้งาน', icon: 'log' },
    ],
  },
  {
    // group roles กว้างพอให้จัดซื้อเข้าเมนูนี้ได้ (จัดการเฉพาะผู้ผลิต) — child แต่ละตัวจำกัดสิทธิ์ละเอียดกว่าอีกชั้น
    // เหมือน pattern ของกลุ่ม /iqc ด้านบน (bills roles แคบกว่า group roles)
    path: '/master', label: 'Master List', icon: 'settings', roles: ['admin', 'purchasing', 'purchasing_manager'],
    children: [
      { path: '/master/suppliers', label: 'ผู้ผลิต', icon: 'building' },
      { path: '/master/products', label: 'สินค้า', icon: 'box', roles: ['admin'] },
      { path: '/master/product-groups', label: 'กลุ่มสินค้า', icon: 'folder', roles: ['admin'] },
      { path: '/master/defect-categories', label: 'กลุ่มปัญหา', icon: 'tag', roles: ['admin'] },
      { path: '/master/units', label: 'หน่วยนับ', icon: 'ruler', roles: ['admin'] },
      { path: '/master/colors', label: 'สีสินค้า', icon: 'palette', roles: ['admin'] },
    ],
  },
];

// เทียบ path เดียวกับที่ NavLink ใช้ (`end` prop) — child ที่ตั้ง end:true ต้อง match แบบตรงเป๊ะเท่านั้น ไม่ใช่
// prefix เฉยๆ กัน path ที่ซ้อนกัน (เช่น '/fg-production' ของกลุ่ม production-qc เป็น prefix ของ
// '/fg-production/material-defects' ที่จริงเป็น child ของกลุ่ม iqc) ทำให้กลุ่ม/tab ผิดถูก mark active ไปด้วย
// ใช้ร่วมกันทั้ง Sidebar.jsx (desktop) และ BottomNav.jsx (mobile)
export function matchesChild(pathname, child) {
  return child.end ? pathname === child.path : pathname.startsWith(child.path);
}

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
  draft: { label: 'ร่าง', color: 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200' },
  pending_approval: { label: 'รออนุมัติ', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' },
  approved: { label: 'อนุมัติแล้ว', color: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' },
  pending_supervisor: { label: 'รอหัวหน้า QC', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' },
  pending_manager: { label: 'รอ QC Manager', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' },
  pending_qmr_open: { label: 'รอ QMR เปิด', color: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' },
  pending_purchasing_review: { label: 'รอจัดซื้อ Review', color: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-800 dark:text-cyan-200' },
  pending_supplier: { label: 'รอ Supplier', color: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200' },
  pending_manager_review: { label: 'รอ Manager ตรวจ', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' },
  pending_supplier_resubmit: { label: 'ถูกส่งกลับ — รอ Supplier ตอบใหม่', color: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' },
  pending_qmr_close: { label: 'รอ QMR ปิด', color: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' },
  pending_uai: { label: 'รอดำเนินการ UAI', color: 'bg-violet-100 dark:bg-violet-900 text-violet-800 dark:text-violet-200' },
  closed: { label: 'ปิดแล้ว', color: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' },
  ncp_closed: { label: 'NCP ปิดแล้ว', color: 'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-200' },
  uai_pending_qc_manager: { label: 'UAI รอ QC Manager', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  uai_pending_purchasing: { label: 'UAI รอจัดซื้อ', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  uai_pending_cco: { label: 'UAI รอ CCO', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  uai_pending_cmo: { label: 'UAI รอ CMO', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  uai_pending_cpo: { label: 'UAI รอ CPO', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  uai_pending_qc_ack: { label: 'UAI รอ QC รับทราบ', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  uai_pending_production_ack: { label: 'UAI รอผลิตรับทราบ', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  uai_pending_qmr_ack: { label: 'UAI รอ QMR รับทราบ', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  uai_completed: { label: 'UAI เสร็จสมบูรณ์', color: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' },
  uai_rejected: { label: 'UAI ปฏิเสธ', color: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' },
  uai_rejected_by_exec: { label: 'UAI ไม่อนุมัติโดย C-Level', color: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' },
  passed: { label: 'ผ่าน', color: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' },
  failed: { label: 'ไม่ผ่าน', color: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' },
  // IPQC record statuses
  open: { label: 'เปิด', color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  in_progress: { label: 'กำลังแก้ไข', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  cancelled: { label: 'ยกเลิก', color: 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200' },
  // FQC results
  pass: { label: 'ผ่าน', color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  fail: { label: 'ไม่ผ่าน', color: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' },
  conditional_pass: { label: 'ผ่านมีเงื่อนไข', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  // FNCP statuses
  fncp_open:                { label: 'FNCP เปิด',              color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  fncp_in_progress:         { label: 'กำลังดำเนินการ',         color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  fncp_waiting_verify:      { label: 'รอ QC ตรวจสอบ',          color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  fncp_supervisor_approved: { label: 'Supervisor อนุมัติแล้ว', color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
  fncp_verified:            { label: 'QC ยืนยันแล้ว',          color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
  fncp_closed:              { label: 'ปิดแล้ว',                 color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  fncp_reject:              { label: 'QC ปฏิเสธ',               color: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' },
  fncp_fuai_opened:         { label: 'เปิด FUAI แล้ว',          color: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
  waiting_verify:           { label: 'รอ QC ตรวจสอบ',           color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  supervisor_approved:      { label: 'Supervisor อนุมัติแล้ว',  color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
  fuai_opened:              { label: 'เปิด FUAI แล้ว',          color: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
  // FUAI statuses
  pending_prod_manager:      { label: 'รอผู้จัดการฝ่ายผลิต',    color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  pending_cpo:               { label: 'รอ CPO อนุมัติ',          color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  pending_qc_manager:        { label: 'รอ QC Manager',           color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  pending_qc_staff_ack:      { label: 'รอ QC Staff รับทราบ',     color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  pending_qc_supervisor_ack: { label: 'รอ QC Supervisor รับทราบ',color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  fuai_closed:               { label: 'FUAI ปิดแล้ว',            color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  fuai_rejected:             { label: 'FUAI ถูกปฏิเสธ',          color: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' },
  rejected:                  { label: 'ถูกปฏิเสธ',               color: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' },
  // IPNCR statuses
  acknowledged:              { label: 'รับทราบแล้ว',           color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  prod_acknowledged:         { label: 'ผลิตรับทราบแล้ว',       color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  rechecking:                { label: 'กำลัง Recheck',         color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  prod_manager_approved:     { label: 'ผลิตส่งให้ QC ตรวจ',   color: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
  qc_supervisor_verified:    { label: 'QC Supervisor ยืนยัน',  color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
  completed:                 { label: 'แจ้งผลแล้ว',            color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  verified:                  { label: 'QC ตรวจสอบแล้ว',        color: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
  // IPNCP statuses
  correcting:      { label: 'กำลังแก้ไข',      color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  correction_done: { label: 'แก้ไขแล้ว',       color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  accepted:        { label: 'QC รับผล',         color: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
  // KPI Report statuses
  kpi_draft: { label: 'ร่าง', color: 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200' },
  kpi_pending_qc_manager: { label: 'รอ QC Manager', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' },
  kpi_pending_cpo: { label: 'รอ CPO', color: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' },
  kpi_pending_qmr: { label: 'รอ QMR', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  kpi_approved: { label: 'อนุมัติแล้ว', color: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' },
  kpi_rejected: { label: 'ถูกปฏิเสธ', color: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' },
};
