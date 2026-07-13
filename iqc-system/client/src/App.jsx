import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProcessingProvider } from './contexts/ProcessingContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProcessingToast from './components/UI/ProcessingToast';
import AppLayout from './components/Layout/AppLayout';
import Login from './pages/Login';

// Pages
import Dashboard from './pages/Dashboard/index';
import BillList from './pages/Bills/index';
import BillNew from './pages/Bills/New';
import BillDetail from './pages/Bills/Detail';
import NCRList from './pages/NCR/index';
import NCRNew from './pages/NCR/New';
import NCRDetail from './pages/NCR/Detail';
import UAIList from './pages/UAI/index';
import UAIDetail from './pages/UAI/Detail';
import MasterLayout from './pages/Master/index';
import Suppliers from './pages/Master/Suppliers';
import ProductGroups from './pages/Master/ProductGroups';
import Products from './pages/Master/Products';
import Units from './pages/Master/Units';
import DefectCategories from './pages/Master/DefectCategories';
import Colors from './pages/Master/Colors';
import AdminUsers from './pages/Admin/Users';
import AdminSettings from './pages/Admin/Settings';
import AdminHolidays from './pages/Admin/Holidays';
import AdminAuditLogs from './pages/Admin/AuditLogs';
import ReportsLayout from './pages/Reports/index';
import ReceivingReport from './pages/Reports/Receiving';
import NCRReport from './pages/Reports/NCRReport';
import UAIReport from './pages/Reports/UAIReport';
import SummaryReport from './pages/Reports/Summary';
import NCRResponse from './pages/Supplier/NCRResponse';
import DeliveryCalendar from './pages/Delivery/index';
import IssueTalkList from './pages/IssueTalk/index';
import IssueTalkDetail from './pages/IssueTalk/Detail';
import QCAttendanceOverview from './pages/QCAttendance/index';
import QCCheckIn from './pages/QCAttendance/CheckIn';
import QCEmployeeHistory from './pages/QCAttendance/EmployeeHistory';
import QCAttendanceStats from './pages/QCAttendance/AttendanceStats';
import KPIPage from './pages/KPI/index';
import KPIReportDetail from './pages/KPI/ReportDetail';
import ProductionMaster from './pages/Admin/ProductionMaster';
import ProCodeSapPage from './pages/Admin/ProCodeSap';
import ProductionQCDashboard from './pages/FQC/Dashboard';
import FGProductionPage from './pages/FGProduction/index';
import FNCPList from './pages/FGProduction/FNCPList';
import FNCPDetail from './pages/FGProduction/FNCPDetail';
import FNCPResponse from './pages/FGProduction/FNCPResponse';
import FUAIList from './pages/FGProduction/FUAIList';
import FUAIDetail from './pages/FGProduction/FUAIDetail';
import MaterialDefects from './pages/FGProduction/MaterialDefects';
import IPQCList from './pages/ProductionQC/IPQCList';
import IPQCNew from './pages/ProductionQC/IPQCNew';
import IPQCDetail from './pages/ProductionQC/IPQCDetail';
import IPNCRList from './pages/ProductionQC/IPNCRList';
import IPNCRDetail from './pages/ProductionQC/IPNCRDetail';

const PROD_QC_ROLES = ['admin','qc_staff','qc_supervisor','qc_manager','cpo','production_manager','prod_supervisor'];

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted">กำลังโหลด...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted">กำลังโหลด...</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/supplier/ncr/:token" element={<NCRResponse />} />
      <Route path="/fncp-response/:token" element={<FNCPResponse />} />

      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="bills" element={<BillList />} />
        <Route path="bills/new" element={<ProtectedRoute roles={['qc_staff']}><BillNew /></ProtectedRoute>} />
        <Route path="bills/:id" element={<BillDetail />} />
        <Route path="ncr" element={<NCRList />} />
        <Route path="ncr/new" element={<ProtectedRoute roles={['qc_staff', 'qc_supervisor']}><NCRNew /></ProtectedRoute>} />
        <Route path="ncr/:id" element={<NCRDetail />} />
        <Route path="uai" element={<UAIList />} />
        <Route path="uai/:id" element={<UAIDetail />} />
        <Route path="delivery" element={<DeliveryCalendar />} />
        <Route path="kpi">
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<KPIPage />} />
          <Route path="summary"   element={<KPIPage />} />
          <Route path="bantuk"    element={<KPIPage />} />
          <Route path="setup"     element={<ProtectedRoute roles={['admin']}><KPIPage /></ProtectedRoute>} />
          {/* ⚠️ DEPRECATED (Session 104) — ไม่มีที่ไหนใน UI ลิงก์มาหน้านี้ (kpi_reports ถูกแทนที่ด้วย kpi_actuals+kpi_action_plans) ดู AUDIT.md §3.7/D3 */}
          <Route path="reports/:id" element={<KPIReportDetail />} />
        </Route>
        <Route path="production-qc/dashboard" element={<ProtectedRoute roles={PROD_QC_ROLES}><ProductionQCDashboard /></ProtectedRoute>} />
        <Route path="production-qc/ipqc" element={<ProtectedRoute roles={PROD_QC_ROLES}><IPQCList /></ProtectedRoute>} />
        <Route path="production-qc/ipqc/new" element={<ProtectedRoute roles={['admin','qc_staff','qc_supervisor']}><IPQCNew /></ProtectedRoute>} />
        <Route path="production-qc/ipqc/:id" element={<ProtectedRoute roles={PROD_QC_ROLES}><IPQCDetail /></ProtectedRoute>} />
        <Route path="production-qc/ipncr" element={<ProtectedRoute roles={PROD_QC_ROLES}><IPNCRList /></ProtectedRoute>} />
        <Route path="production-qc/ipncr/:id" element={<ProtectedRoute roles={PROD_QC_ROLES}><IPNCRDetail /></ProtectedRoute>} />
        <Route path="fg-production" element={<ProtectedRoute roles={PROD_QC_ROLES}><FGProductionPage /></ProtectedRoute>} />
        <Route path="fg-production/fncp" element={<ProtectedRoute roles={PROD_QC_ROLES}><FNCPList /></ProtectedRoute>} />
        <Route path="fg-production/fncp/:id" element={<ProtectedRoute roles={PROD_QC_ROLES}><FNCPDetail /></ProtectedRoute>} />
        <Route path="fg-production/fuai" element={<ProtectedRoute roles={PROD_QC_ROLES}><FUAIList /></ProtectedRoute>} />
        <Route path="fg-production/fuai/:id" element={<ProtectedRoute roles={PROD_QC_ROLES}><FUAIDetail /></ProtectedRoute>} />
        <Route path="fg-production/material-defects" element={<ProtectedRoute roles={PROD_QC_ROLES}><MaterialDefects /></ProtectedRoute>} />
        <Route path="issue-talk" element={<IssueTalkList />} />
        <Route path="issue-talk/:id" element={<IssueTalkDetail />} />
        <Route path="qc-attendance" element={<ProtectedRoute roles={['qc_staff','qc_supervisor','qc_manager','admin']}><QCAttendanceOverview /></ProtectedRoute>} />
        <Route path="qc-attendance/checkin" element={<ProtectedRoute roles={['qc_staff','qc_supervisor']}><QCCheckIn /></ProtectedRoute>} />
        <Route path="qc-attendance/employee/:userId" element={<ProtectedRoute roles={['qc_staff','qc_supervisor','qc_manager','admin']}><QCEmployeeHistory /></ProtectedRoute>} />
        <Route path="qc-attendance/stats" element={<ProtectedRoute roles={['qc_supervisor','qc_manager','admin']}><QCAttendanceStats /></ProtectedRoute>} />
        <Route path="admin" element={<ProtectedRoute roles={['admin']}><Outlet /></ProtectedRoute>}>
          <Route path="users" element={<AdminUsers />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="production-master" element={<ProductionMaster />} />
          <Route path="procode-sap" element={<ProCodeSapPage />} />
          <Route path="holidays" element={<AdminHolidays />} />
          <Route path="audit-logs" element={<AdminAuditLogs />} />
        </Route>
        <Route path="master" element={<MasterLayout />}>
          <Route index element={<Navigate to="suppliers" replace />} />
          <Route path="suppliers" element={<ProtectedRoute roles={['admin', 'purchasing', 'purchasing_manager']}><Suppliers /></ProtectedRoute>} />
          <Route path="product-groups" element={<ProtectedRoute roles={['admin']}><ProductGroups /></ProtectedRoute>} />
          <Route path="products" element={<ProtectedRoute roles={['admin']}><Products /></ProtectedRoute>} />
          <Route path="units" element={<ProtectedRoute roles={['admin']}><Units /></ProtectedRoute>} />
          <Route path="defect-categories" element={<ProtectedRoute roles={['admin']}><DefectCategories /></ProtectedRoute>} />
          <Route path="colors" element={<ProtectedRoute roles={['admin']}><Colors /></ProtectedRoute>} />
        </Route>
        <Route path="reports" element={<ProtectedRoute roles={['qc_manager','cco','cmo','cpo']}><ReportsLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="summary" replace />} />
          <Route path="receiving" element={<ReceivingReport />} />
          <Route path="ncr" element={<NCRReport />} />
          <Route path="uai" element={<UAIReport />} />
          <Route path="summary" element={<SummaryReport />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <ProcessingProvider>
          <AuthProvider>
            <AppRoutes />
            <ProcessingToast />
          </AuthProvider>
        </ProcessingProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
