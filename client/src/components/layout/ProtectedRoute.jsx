import { Navigate, Outlet, useLocation } from 'react-router-dom';
// import { useAuth, HOME } from '../../context/AuthContext';
// import { DriveProvider } from '../../context/DriveContext';
 import { PageSkeleton } from '../ui';
// import AppLayout from './AppLayout';

export function Splash() {
  return <div className="mx-auto max-w-4xl p-10"><PageSkeleton /></div>;
}

export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <DriveProvider><AppLayout /></DriveProvider>;
}

export function RedirectHome() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  return <Navigate to={user ? HOME[user.role] : '/'} replace />;
}
