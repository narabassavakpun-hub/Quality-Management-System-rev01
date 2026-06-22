import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProcessingProvider } from './contexts/ProcessingContext';
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
        <Route path="issue-talk" element={<IssueTalkList />} />
        <Route path="issue-talk/:id" element={<IssueTalkDetail />} />
        <Route path="qc-attendance" element={<ProtectedRoute roles={['qc_staff','qc_supervisor','qc_manager','admin']}><QCAttendanceOverview /></ProtectedRoute>} />
        <Route path="qc-attendance/checkin" element={<ProtectedRoute roles={['qc_staff','qc_supervisor']}><QCCheckIn /></ProtectedRoute>} />
        <Route path="qc-attendance/employee/:userId" element={<ProtectedRoute roles={['qc_staff','qc_supervisor','qc_manager','admin']}><QCEmployeeHistory /></ProtectedRoute>} />
        <Route path="qc-attendance/stats" element={<ProtectedRoute roles={['qc_supervisor','qc_manager','admin']}><QCAttendanceStats /></ProtectedRoute>} />
        <Route path="admin" element={<ProtectedRoute roles={['admin']}><Outlet /></ProtectedRoute>}>
          <Route path="users" element={<AdminUsers />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="holidays" element={<AdminHolidays />} />
        </Route>
        <Route path="master" element={<ProtectedRoute roles={['admin']}><MasterLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="suppliers" replace />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="product-groups" element={<ProductGroups />} />
          <Route path="products" element={<Products />} />
          <Route path="units" element={<Units />} />
          <Route path="defect-categories" element={<DefectCategories />} />
          <Route path="colors" element={<Colors />} />
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
    <BrowserRouter>
      <ProcessingProvider>
        <AuthProvider>
          <AppRoutes />
          <ProcessingToast />
        </AuthProvider>
      </ProcessingProvider>
    </BrowserRouter>
  );
}
