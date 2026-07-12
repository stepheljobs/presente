import type { ReactNode } from 'react';
import AppNav from './AppNav';

/** Shell for authenticated routes: consistent header + page content. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <AppNav />
      {children}
    </div>
  );
}
