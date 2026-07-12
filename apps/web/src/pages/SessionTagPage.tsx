import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { TopNav } from './DashboardPage';

interface Tag {
  id: string;
  photoId: string | null;
  workerId: string | null;
  workerName: string | null;
  source: string;
  status: string;
  band: string | null;
  notice: { flag?: string } | null;
}

interface Worker {
  id: string;
  fullName: string;
}

interface SessionDetail {
  id: string;
  type: string;
  siteName: string | null;
  lat: number | null;
  lng: number | null;
  siteLat: number | null;
  siteLng: number | null;
  radiusM: number | null;
  withinFence: boolean | null;
  distanceM: number | null;
  mockLocation: boolean;
  photos: { id: string; storageKey: string; recognitionStatus: string }[];
  tags: Tag[];
}

/** E8-S10/S11: photo tagging workspace + admin tag/retag/untag. */
export default function SessionTagPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [roster, setRoster] = useState<Worker[]>([]);
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [s, w] = await Promise.all([
      apiFetch<SessionDetail>(`/dashboard/sessions/${id}`),
      apiFetch<{ items: Worker[] }>('/workers?pageSize=200'),
    ]);
    setSession(s);
    setRoster(w.items ?? []);
  }, [id]);

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : 'Load failed'),
    );
  }, [load]);

  async function adminTag(
    action: 'tag' | 'retag' | 'untag',
    opts: { tagId?: string; workerId?: string; photoId?: string },
  ) {
    if (!id) return;
    if (reason.trim().length < 3) {
      setError('Reason note is required (min 3 chars)');
      return;
    }
    try {
      const s = await apiFetch<SessionDetail>(
        `/dashboard/sessions/${id}/admin-tag`,
        {
          method: 'POST',
          body: { action, reason: reason.trim(), ...opts },
        },
      );
      setSession(s);
      setNotice(`${action} saved`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tag failed');
    }
  }

  if (!session) {
    return (
      <main className="page-pad">
        <TopNav active="today" />
        <p className="muted" style={{ padding: '1.2rem' }}>
          {error ?? 'Loading…'}
        </p>
      </main>
    );
  }

  const filtered = roster.filter((w) =>
    w.fullName.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <main className="page-pad">
      <TopNav active="today" />
      {error && <p className="error" style={{ padding: '0 1.2rem' }}>{error}</p>}
      {notice && <p className="notice" style={{ padding: '0 1.2rem' }}>{notice}</p>}

      <section className="card-block">
        <h2>
          Session · {session.type} · {session.siteName}
        </h2>
        <p className="muted">
          Geofence:{' '}
          {session.withinFence === null
            ? 'n/a'
            : session.withinFence
              ? 'pass'
              : `fail (${session.distanceM ?? '?'} m)`}
          {session.mockLocation && ' · mock location'}
        </p>
        {session.lat != null && session.lng != null && (
          <p className="muted">
            Session pin: {session.lat.toFixed(5)}, {session.lng.toFixed(5)}
            {session.siteLat != null &&
              ` · site ${session.siteLat.toFixed(5)}, ${session.siteLng?.toFixed(5)} r=${session.radiusM}m`}
          </p>
        )}
      </section>

      <div className="tag-workspace">
        <section className="card-block">
          <h3>Photos</h3>
          {session.photos.map((p) => (
            <div key={p.id} className="photo-tile">
              <div className="photo-placeholder">{p.storageKey.slice(-24)}</div>
              <span className="badge">{p.recognitionStatus}</span>
            </div>
          ))}
          <h3>Tags</h3>
          <ul>
            {session.tags.map((t) => (
              <li key={t.id}>
                <strong>{t.workerName ?? 'untagged'}</strong> · {t.source} ·{' '}
                {t.status}
                {t.band && ` · ${t.band}`}
                {t.notice?.flag === 'manual_tag_admin' && (
                  <span className="badge">admin</span>
                )}
                {t.status === 'active' && (
                  <button
                    type="button"
                    className="linklike"
                    onClick={() =>
                      void adminTag('untag', { tagId: t.id })
                    }
                  >
                    untag
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card-block">
          <h3>Roster</h3>
          <label className="edit-form">
            Reason (required for admin actions)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you changing this tag?"
            />
          </label>
          <input
            className="edit-form"
            placeholder="Search roster…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', marginBottom: 8, padding: 8 }}
          />
          <ul className="worker-list">
            {filtered.slice(0, 30).map((w) => (
              <li key={w.id}>
                {w.fullName}{' '}
                <button
                  type="button"
                  onClick={() =>
                    void adminTag('tag', {
                      workerId: w.id,
                      photoId: session.photos[0]?.id,
                    })
                  }
                >
                  Tag
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">
            <Link to="/exceptions">Back to exceptions</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
