import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';

interface Headcount {
  siteId: string;
  siteName: string;
  roster: number;
  taggedIn: number;
  label: string;
}

interface Photo {
  id: string;
  storageKey: string;
  sessionId: string;
  siteName: string | null;
  sessionType: string;
  capturedAt: string;
  recognitionStatus: string;
}

interface Device {
  deviceId: string;
  engineerEmail: string;
  lastSync: string | null;
  sessions24h: number;
  stale: boolean;
}

/** E8-S01/S02/S03: Today view — headcount, photo feed, device sync. */
export default function DashboardPage() {
  const [sites, setSites] = useState<Headcount[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, p, d] = await Promise.all([
        apiFetch<Headcount[]>('/dashboard/today'),
        apiFetch<Photo[]>('/dashboard/photos?limit=24'),
        apiFetch<Device[]>('/dashboard/devices'),
      ]);
      setSites(h);
      setPhotos(p);
      setDevices(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main className="page-pad">
      <TopNav active="today" />
      {error && <p className="error" style={{ padding: '0 1.2rem' }}>{error}</p>}

      <section className="card-block">
        <h2>Today by site</h2>
        {sites.length === 0 ? (
          <p className="muted">No active sites or sessions today.</p>
        ) : (
          <div className="headcount-grid">
            {sites.map((s) => (
              <div key={s.siteId} className="headcount-card">
                <strong>{s.siteName}</strong>
                <span className="big">{s.label}</span>
                <span className="muted">
                  {s.taggedIn} tagged · {s.roster} on roster
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-block">
        <h2>Live photo feed</h2>
        <div className="photo-feed">
          {photos.map((p) => (
            <Link
              key={p.id}
              to={`/sessions/${p.sessionId}`}
              className="photo-tile"
            >
              <div className="photo-placeholder">{p.sessionType}</div>
              <span className="muted">
                {p.siteName ?? '—'} ·{' '}
                {new Date(p.capturedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="badge">{p.recognitionStatus}</span>
            </Link>
          ))}
          {photos.length === 0 && (
            <p className="muted">No session photos yet today.</p>
          )}
        </div>
      </section>

      <section className="card-block">
        <h2>Engineer devices</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Engineer</th>
              <th>Device</th>
              <th>Last sync</th>
              <th>24h sessions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.deviceId + d.engineerEmail} className={d.stale ? 'stale-row' : ''}>
                <td>{d.engineerEmail}</td>
                <td className="mono">{d.deviceId}</td>
                <td>
                  {d.lastSync
                    ? new Date(d.lastSync).toLocaleString()
                    : 'never'}
                  {d.stale && <span className="badge">stale</span>}
                </td>
                <td>{d.sessions24h}</td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No devices have synced sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

export function TopNav({ active }: { active: string }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        Presente
      </Link>
      <Link to="/" className={active === 'today' ? 'nav-active' : ''}>
        Today
      </Link>
      <Link
        to="/exceptions"
        className={active === 'exceptions' ? 'nav-active' : ''}
      >
        Exceptions
      </Link>
      <Link to="/reports" className={active === 'reports' ? 'nav-active' : ''}>
        Reports
      </Link>
      <Link to="/attendance">Attendance</Link>
      <Link to="/payroll">Payroll</Link>
      <Link to="/sites">Sites</Link>
      <Link to="/workers">Workers</Link>
      <Link to="/settings">Settings</Link>
    </header>
  );
}
