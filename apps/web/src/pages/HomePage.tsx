import { Link, useNavigate } from 'react-router-dom';
import { currentUser, logout } from '../lib/auth';

export default function HomePage() {
  const navigate = useNavigate();
  const user = currentUser()!; // RequireAuth guarantees presence

  return (
    <main className="home-page">
      <header className="topbar">
        <span className="brand">Presente</span>
        <span className="whoami">
          {user.email} · <strong>{user.role}</strong>
        </span>
        <Link to="/sites">Sites</Link>
        <Link to="/settings">Settings</Link>
        <button
          onClick={() => {
            logout();
            navigate('/login', { replace: true });
          }}
        >
          Sign out
        </button>
      </header>
      <section className="empty-state">
        <h2>Dashboard</h2>
        <p>Today view, exceptions and payroll land here in later epics.</p>
      </section>
    </main>
  );
}
