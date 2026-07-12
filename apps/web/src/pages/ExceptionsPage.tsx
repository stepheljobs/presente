import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AppShell, Badge, Card, TableWrap } from '../components/ui';
import { apiFetch } from '../lib/api';

interface ExceptionItem {
  id: string;
  type: string;
  severity: number;
  workerId: string | null;
  workerName: string | null;
  sessionId: string | null;
  siteId: string | null;
  siteName: string | null;
  day: string | null;
  note: string | null;
  status: string;
  createdAt: string;
}

const RESOLUTIONS: Record<string, { value: string; label: string; needsNote?: boolean }[]> = {
  missing_time_out: [
    { value: 'set_halfday', label: 'Set halfday' },
    { value: 'set_out_time', label: 'Set actual out-time', needsNote: true },
    { value: 'mark_absent_pm', label: 'Mark absent PM' },
  ],
  missing_time_in: [
    { value: 'set_halfday', label: 'Set halfday' },
    { value: 'mark_absent', label: 'Mark absent', needsNote: true },
  ],
  manual_tag: [
    { value: 'approve_manual', label: 'Approve tag' },
    { value: 'reject_manual', label: 'Reject (mark absent)', needsNote: true },
  ],
  geofence: [
    { value: 'accept_geofence', label: 'Accept (reason)', needsNote: true },
    { value: 'reject_session', label: 'Reject session', needsNote: true },
  ],
  recognition_disagreement: [
    { value: 'keep_engineer', label: 'Keep engineer tag' },
    { value: 'use_recognition', label: 'Use recognition match' },
    { value: 'mark_absent', label: 'Mark absent', needsNote: true },
  ],
  mock_location: [
    { value: 'resolve', label: 'Accept with note', needsNote: true },
    { value: 'waive', label: 'Waive', needsNote: true },
  ],
  clock_drift: [
    { value: 'resolve', label: 'Acknowledge', needsNote: true },
    { value: 'waive', label: 'Waive', needsNote: true },
  ],
  correction_request: [
    { value: 'resolve', label: 'Mark resolved', needsNote: true },
  ],
  enrollment_approval: [
    { value: 'resolve', label: 'Handled on Workers page' },
  ],
  site_transfer: [
    { value: 'resolve', label: 'Acknowledge transfer', needsNote: true },
  ],
  no_biometric_consent: [
    { value: 'resolve', label: 'Acknowledged', needsNote: true },
  ],
};

/** E8-S05–S09: severity-sorted queue + typed resolvers. */
export default function ExceptionsPage() {
  const [items, setItems] = useState<ExceptionItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<ExceptionItem | null>(null);
  const [note, setNote] = useState('');
  const [outTime, setOutTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ status: 'open' });
    if (type) q.set('type', type);
    const res = await apiFetch<ExceptionItem[] & { counts?: Record<string, number> }>(
      `/exceptions?${q}`,
    );
    setItems([...res]);
    setCounts(res.counts ?? {});
  }, [type]);

  useEffect(() => {
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : 'Load failed'),
    );
  }, [load]);

  async function resolve(resolution: string) {
    if (!selected) return;
    setError(null);
    try {
      await apiFetch(`/exceptions/${selected.id}/resolve-typed`, {
        method: 'POST',
        body: {
          resolution,
          note: note.trim() || undefined,
          outTime: outTime || undefined,
        },
      });
      setNotice(`${selected.type} → ${resolution}`);
      setSelected(null);
      setNote('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve failed');
    }
  }

  const actions = selected
    ? RESOLUTIONS[selected.type] ?? [
        { value: 'resolve', label: 'Resolve', needsNote: true },
        { value: 'waive', label: 'Waive', needsNote: true },
      ]
    : [];

  return (
    <AppShell active="exceptions" title="Exceptions" eyebrow="Resolution queue">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <section className="toolbar">
        <label>
          Type{' '}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {Object.keys(counts)
              .sort()
              .map((t) => (
                <option key={t} value={t}>
                  {t} ({counts[t]})
                </option>
              ))}
          </select>
        </label>
        <span className="muted">{items.length} open</span>
      </section>

      <Card title="Exceptions queue" description="Severity-sorted issues that need review.">
        <TableWrap>
          <table className="data-table">
            <thead>
              <tr>
                <th>Sev</th>
                <th>Type</th>
                <th>Worker</th>
                <th>Site</th>
                <th>Day</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr
                  key={e.id}
                  className="clickable"
                  onClick={() => {
                    setSelected(e);
                    setNote(e.note ?? '');
                  }}
                >
                  <td>{e.severity}</td>
                  <td>
                    <Badge>{e.type}</Badge>
                  </td>
                  <td>{e.workerName ?? '—'}</td>
                  <td>{e.siteName ?? '—'}</td>
                  <td>{e.day ?? '—'}</td>
                  <td className="muted">{e.note ?? ''}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Queue is clear.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {selected && (
        <Card
          title={`Resolve · ${selected.type}`}
          actions={
            <button type="button" className="secondary" onClick={() => setSelected(null)}>
              Close
            </button>
          }
        >
          <p>
            {selected.workerName} · {selected.siteName} · {selected.day}
          </p>
          {selected.sessionId && (
            <p>
              <Link to={`/sessions/${selected.sessionId}`}>
                Open session / tagging workspace
              </Link>
            </p>
          )}
          {selected.type === 'missing_time_out' && (
            <label className="edit-form">
              Actual out time (ISO, optional)
              <input
                value={outTime}
                onChange={(e) => setOutTime(e.target.value)}
                placeholder="2026-07-12T09:00:00.000Z"
              />
            </label>
          )}
          <label className="edit-form">
            Note
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason / context"
            />
          </label>
          <div className="row-actions">
            {actions.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => void resolve(a.value)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Card>
      )}
    </AppShell>
  );
}
