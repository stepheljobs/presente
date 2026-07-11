import type { ReactNode } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { currentUser } from './lib/auth';
import AcceptInvitePage from './pages/AcceptInvitePage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';
import SignupPage from './pages/SignupPage';
import SitesPage from './pages/SitesPage';
import VerifyPage from './pages/VerifyPage';
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
            <HomePage />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
