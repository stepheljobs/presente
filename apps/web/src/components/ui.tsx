import type { ReactNode } from 'react';
type ActiveNav =
  | 'today'
  | 'exceptions'
  | 'reports'
  | 'attendance'
  | 'payroll'
  | 'sites'
  | 'workers'
  | 'settings';

export function AppShell({
  title,
  eyebrow,
  actions,
  children,
}: {
  active?: ActiveNav;
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
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
