import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AppShell, Badge, Card, EmptyState, TableWrap } from '../components/ui';
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
    <AppShell active="today" title="Today" eyebrow="Live operations">
      {error && <Alert tone="error">{error}</Alert>}

      <Card
        title="Today by site"
        description="Current tagged headcount against each active roster."
      >
        {sites.length === 0 ? (
          <EmptyState>No active sites or sessions today.</EmptyState>
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
      </Card>

      <Card
        title="Live photo feed"
        description="Recent capture sessions ready for review or tagging."
      >
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
              <Badge>{p.recognitionStatus}</Badge>
            </Link>
          ))}
          {photos.length === 0 && (
            <EmptyState>No session photos yet today.</EmptyState>
          )}
        </div>
      </Card>

      <Card title="Engineer devices" description="Sync health from field devices.">
        <TableWrap>
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
                <tr
                  key={d.deviceId + d.engineerEmail}
                  className={d.stale ? 'stale-row' : ''}
                >
                  <td>{d.engineerEmail}</td>
                  <td className="mono">{d.deviceId}</td>
                  <td>
                    {d.lastSync
                      ? new Date(d.lastSync).toLocaleString()
                      : 'never'}
                    {d.stale && <Badge tone="warning">stale</Badge>}
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
        </TableWrap>
      </Card>
    </AppShell>
  );
}
