import { Link, useLocation, useNavigate } from 'react-router-dom';
import { currentUser, logout } from '../lib/auth';

/** Primary destinations — always shown on authenticated pages. */
const NAV_LINKS = [
  { to: '/', label: 'Today', match: (p: string) => p === '/' },
  {
    to: '/exceptions',
    label: 'Exceptions',
    match: (p: string) => p.startsWith('/exceptions'),
  },
  {
    to: '/reports',
    label: 'Reports',
    match: (p: string) => p.startsWith('/reports'),
  },
  {
    to: '/attendance',
    label: 'Attendance',
    match: (p: string) => p.startsWith('/attendance'),
  },
  {
    to: '/payroll',
    label: 'Payroll',
    match: (p: string) => p.startsWith('/payroll'),
  },
  {
    to: '/sites',
    label: 'Sites',
    match: (p: string) => p.startsWith('/sites'),
  },
  {
    to: '/workers',
    label: 'Workers',
    match: (p: string) => p.startsWith('/workers'),
  },
  {
    to: '/settings',
    label: 'Settings',
    match: (p: string) => p.startsWith('/settings'),
  },
] as const;

/**
 * Shared top navigation for the dashboard SPA. Same links on every
 * authenticated page so the menu never appears to "change" as you move around.
 * Session tagging lives under /sessions/:id and highlights Today (entry from feed).
 */
export default function AppNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = currentUser();

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        Presente
      </Link>
      <nav className="topbar-nav" aria-label="Main">
        {NAV_LINKS.map((link) => {
          const active =
            link.match(pathname) ||
            (link.to === '/' && pathname.startsWith('/sessions/'));
          return (
            <Link
              key={link.to}
              to={link.to}
              className={active ? 'nav-active' : undefined}
              aria-current={active ? 'page' : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      {user && (
        <span className="whoami">
          {user.email} · <strong>{user.role}</strong>
        </span>
      )}
      <button
        type="button"
        className="topbar-signout"
        onClick={() => {
          logout();
          navigate('/login', { replace: true });
        }}
      >
        Sign out
      </button>
    </header>
  );
}
