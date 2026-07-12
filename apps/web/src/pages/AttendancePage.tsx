import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiFetch } from '../lib/api';

interface DayRecord {
  id: string;
  workerId: string;
  workerName: string | null;
  siteId: string | null;
  siteName: string | null;
  day: string;
  timeIn: string | null;
  timeOut: string | null;
  hours: number;
  status: string;
  source: string;
  noBiometricConsent: boolean;
  withinFence: boolean | null;
  adminNote: string | null;
}

interface DayDetail extends DayRecord {
  photos: { id: string; storageKey: string; recognitionStatus: string }[];
  audit: {
    actor: string | null;
    action: string;
    reason: string | null;
    createdAt: string;
    before: unknown;
    after: unknown;
  }[];
}

interface Correction {
  id: string;
  workerName: string | null;
  day: string;
  reason: string;
  status: string;
  proposed: unknown;
}

/**
 * E6-S03/S04/S06: attendance list, drill-down, admin edit, correction review.
 */
export default function AttendancePage() {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<DayRecord[]>([]);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('halfday');
  const [editReason, setEditReason] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, corr] = await Promise.all([
        apiFetch<DayRecord[]>(`/day-records?day=${day}`),
        apiFetch<Correction[]>('/corrections?status=submitted').catch(
          () => [] as Correction[],
        ),
      ]);
      setRows(list);
      setCorrections(corr);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  async function recompute() {
    setNotice(null);
    try {
      const res = await apiFetch<{ written: number }>('/day-records/recompute', {
        method: 'POST',
        body: { day },
      });
      setNotice(`Recomputed ${res.written} day record(s)`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recompute failed');
    }
  }

  async function openDetail(id: string) {
    setDetail(await apiFetch<DayDetail>(`/day-records/${id}`));
    setEditReason('');
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    if (editReason.trim().length < 3) {
      setError('Reason is required (min 3 characters)');
      return;
    }
    try {
      await apiFetch(`/day-records/${detail.id}`, {
        method: 'PUT',
        body: { status: editStatus, reason: editReason.trim() },
      });
      setNotice('Day record updated');
      await openDetail(detail.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Edit failed');
    }
  }

  async function reviewCorrection(
    id: string,
    decision: 'approved' | 'rejected',
  ) {
    const note =
      decision === 'rejected'
        ? window.prompt('Reject note (required)') ?? ''
        : window.prompt('Optional note') ?? 'Approved';
    if (decision === 'rejected' && note.trim().length < 1) return;
    try {
      await apiFetch(`/corrections/${id}/review`, {
        method: 'POST',
        body: { decision, note },
      });
      setNotice(`Correction ${decision}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    }
  }

  return (
    <main className="page-pad attendance-page">
      <section className="toolbar">
        <label>
          Day{' '}
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <button type="button" onClick={() => void recompute()}>
          Recompute day
        </button>
      </section>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {corrections.length > 0 && (
        <section className="card-block">
          <h2>Correction requests</h2>
          <ul className="worker-list">
            {corrections.map((c) => (
              <li key={c.id}>
                <strong>{c.workerName}</strong> · {c.day}
                <div className="muted">{c.reason}</div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => void reviewCorrection(c.id, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void reviewCorrection(c.id, 'rejected')}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card-block">
        <h2>Day records · {day}</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Site</th>
              <th>In</th>
              <th>Out</th>
              <th>Hours</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="clickable"
                onClick={() => void openDetail(r.id)}
              >
                <td>
                  {r.workerName}
                  {r.noBiometricConsent && (
                    <span className="badge">no biometrics</span>
                  )}
                </td>
                <td>{r.siteName ?? '—'}</td>
                <td>{fmtTime(r.timeIn)}</td>
                <td>{fmtTime(r.timeOut)}</td>
                <td>{r.hours}</td>
                <td>{r.status}</td>
                <td>{r.source}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No records — capture sessions then recompute.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {detail && (
        <section className="card-block drilldown">
          <div className="toolbar">
            <h2>
              {detail.workerName} · {detail.day}
            </h2>
            <button type="button" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
          <p>
            {detail.siteName} · {detail.hours}h · {detail.status} · source{' '}
            {detail.source}
          </p>
          <p className="muted">
            Geofence:{' '}
            {detail.withinFence === null
              ? 'n/a'
              : detail.withinFence
                ? 'pass'
                : 'fail'}
            {detail.adminNote && ` · note: ${detail.adminNote}`}
          </p>
          <h3>Photos ({detail.photos.length})</h3>
          <ul className="muted">
            {detail.photos.map((p) => (
              <li key={p.id}>
                {p.storageKey} · {p.recognitionStatus}
              </li>
            ))}
            {detail.photos.length === 0 && <li>No linked photos</li>}
          </ul>
          <h3>Audit trail</h3>
          <ul className="muted">
            {detail.audit.map((a, i) => (
              <li key={i}>
                {a.createdAt.slice(0, 19)} · {a.action}
                {a.reason ? ` — ${a.reason}` : ''}
              </li>
            ))}
            {detail.audit.length === 0 && <li>No audit entries yet</li>}
          </ul>

          <form onSubmit={(e) => void saveEdit(e)} className="edit-form">
            <h3>Admin edit</h3>
            <label>
              Status
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
              >
                <option value="present">Present</option>
                <option value="halfday">Halfday</option>
                <option value="absent">Absent</option>
                <option value="ot_candidate">OT candidate</option>
              </select>
            </label>
            <label>
              Reason (required)
              <input
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Why is this change needed?"
                required
                minLength={3}
              />
            </label>
            <button type="submit">Save edit</button>
          </form>
        </section>
      )}
    </main>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}
