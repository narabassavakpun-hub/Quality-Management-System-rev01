import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import QCStaffDash from './QCStaffDash';
import SupervisorDash from './SupervisorDash';
import ManagerDash from './ManagerDash';
import QMRDash from './QMRDash';
import PurchasingDash from './PurchasingDash';
import ManagerPurchasingDash from './ManagerPurchasingDash';
import ExecutiveDash from './ExecutiveDash';
import ProductionDash from './ProductionDash';
import AdminDash from './AdminDash';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const roleMap = {
    qc_staff: <QCStaffDash navigate={navigate} />,
    qc_supervisor: <SupervisorDash navigate={navigate} />,
    qc_manager: <ManagerDash navigate={navigate} />,
    qmr: <QMRDash navigate={navigate} />,
    purchasing: <PurchasingDash navigate={navigate} />,
    purchasing_manager: <ManagerPurchasingDash navigate={navigate} />,
    cco: <ExecutiveDash navigate={navigate} />,
    cmo: <ExecutiveDash navigate={navigate} />,
    cpo: <ExecutiveDash navigate={navigate} />,
    production_manager: <ProductionDash navigate={navigate} />,
    admin: <AdminDash navigate={navigate} />,
  };

  return roleMap[user?.role] || <div className="page-title">ยินดีต้อนรับ</div>;
}
