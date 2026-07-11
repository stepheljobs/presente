import type { ReactNode } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { currentUser } from './lib/auth';
import AcceptInvitePage from './pages/AcceptInvitePage';
import AttendancePage from './pages/AttendancePage';
import DashboardPage from './pages/DashboardPage';
import ExceptionsPage from './pages/ExceptionsPage';
import LoginPage from './pages/LoginPage';
import PayrollPage from './pages/PayrollPage';
import ReportsPage from './pages/ReportsPage';
import SessionTagPage from './pages/SessionTagPage';
import SettingsPage from './pages/SettingsPage';
import SignupPage from './pages/SignupPage';
import SitesPage from './pages/SitesPage';
import VerifyPage from './pages/VerifyPage';
import WorkersPage from './pages/WorkersPage';
import './App.css';

/** Redirects to /login when the token is absent, malformed, or expired. */
function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!currentUser()) {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname }} />
    );
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/exceptions"
        element={
          <RequireAuth>
            <ExceptionsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/reports"
        element={
          <RequireAuth>
            <ReportsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sessions/:id"
        element={
          <RequireAuth>
            <SessionTagPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sites"
        element={
          <RequireAuth>
            <SitesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/workers"
        element={
          <RequireAuth>
            <WorkersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/attendance"
        element={
          <RequireAuth>
            <AttendancePage />
          </RequireAuth>
        }
      />
      <Route
        path="/payroll"
        element={
          <RequireAuth>
            <PayrollPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
