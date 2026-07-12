import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type ActiveNav =
  | 'today'
  | 'exceptions'
  | 'reports'
  | 'attendance'
  | 'payroll'
  | 'sites'
  | 'workers'
  | 'settings';

const NAV_ITEMS: { to: string; label: string; active: ActiveNav }[] = [
  { to: '/', label: 'Today', active: 'today' },
  { to: '/exceptions', label: 'Exceptions', active: 'exceptions' },
  { to: '/reports', label: 'Reports', active: 'reports' },
  { to: '/attendance', label: 'Attendance', active: 'attendance' },
  { to: '/payroll', label: 'Payroll', active: 'payroll' },
  { to: '/sites', label: 'Sites', active: 'sites' },
  { to: '/workers', label: 'Workers', active: 'workers' },
  { to: '/settings', label: 'Settings', active: 'settings' },
];

export function AppShell({
  active,
  title,
  eyebrow,
  actions,
  children,
}: {
  active: ActiveNav;
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="app-shell">
      <TopNav active={active} />
      <div className="page-wrap">
        <header className="page-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1>{title}</h1>
          </div>
          {actions && <div className="page-actions">{actions}</div>}
        </header>
        {children}
      </div>
    </main>
  );
}

export function TopNav({ active }: { active: ActiveNav }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Presente dashboard">
        <span className="brand-mark">P</span>
        <span>Presente</span>
      </Link>
      <nav className="nav-links" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={active === item.active ? 'nav-active' : ''}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  tone,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  tone?: 'warning';
  children: ReactNode;
}) {
  return (
    <section className={`card-block${tone ? ` tone-${tone}` : ''}`}>
      {(title || description || actions) && (
        <div className="section-heading">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="muted">{description}</p>}
          </div>
          {actions && <div className="section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'warning';
  children: ReactNode;
}) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`alert ${tone}`}>
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return <span className={`badge ${tone ? `tone-${tone}` : ''}`}>{children}</span>;
}
