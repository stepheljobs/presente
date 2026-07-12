import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AppShell, Badge, Card } from '../components/ui';
import { apiFetch, ApiError } from '../lib/api';
import { accessToken } from '../lib/auth';

interface RunSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totals: {
    workers?: number;
    manDays?: number;
    otHours?: number;
    gross?: number;
  };
}

interface RunDetail extends RunSummary {
  lines: {
    id: string;
    workerId: string;
    workerName: string;
    daysPresent: number;
    halfdays: number;
    otHours: number;
    gross: number;
    adjustments: number;
    detail: { days?: { day: string; status: string; otHoursPaid: number }[] };
  }[];
  blockingExceptions: {
    id: string;
    type: string;
    workerId: string | null;
    day: string | null;
    note: string | null;
  }[];
  adjustments: {
    id: string;
    workerId: string;
    workerName: string;
    amount: number;
    note: string;
  }[];
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** E7-S06–S11: payroll workspace — list, start, grid, review, approve, export. */
export default function PayrollPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [active, setActive] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adjWorker, setAdjWorker] = useState('');
  const [adjAmount, setAdjAmount] = useState('-200');
  const [adjNote, setAdjNote] = useState('');

  const loadRuns = useCallback(async () => {
    setRuns(await apiFetch<RunSummary[]>('/payroll/runs'));
  }, []);

  useEffect(() => {
    void loadRuns().catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to load'),
    );
  }, [loadRuns]);

  async function openRun(id: string) {
    setError(null);
    setActive(await apiFetch<RunDetail>(`/payroll/runs/${id}`));
  }

  async function startRun() {
    setError(null);
    setNotice(null);
    try {
      const period = await apiFetch<{ start: string; end: string }>(
        '/payroll/suggest-period',
      );
      const run = await apiFetch<RunDetail>('/payroll/runs', {
        method: 'POST',
        body: period,
      });
      setNotice(`Started run ${period.start} – ${period.end}`);
      await loadRuns();
      setActive(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start failed');
    }
  }

  async function transition(status: string) {
    if (!active) return;
    setError(null);
    try {
      const run = await apiFetch<RunDetail>(
        `/payroll/runs/${active.id}/transition`,
        { method: 'POST', body: { status } },
      );
      setActive(run);
      setNotice(`Status → ${status}`);
      await loadRuns();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Transition failed');
      }
    }
  }

  async function addAdjustment() {
    if (!active || !adjWorker || !adjNote.trim()) return;
    const run = await apiFetch<RunDetail>(
      `/payroll/runs/${active.id}/adjustments`,
      {
        method: 'POST',
        body: {
          workerId: adjWorker,
          amount: Number(adjAmount),
          note: adjNote.trim(),
        },
      },
    );
    setActive(run);
    setAdjNote('');
    setNotice('Adjustment applied (run back to draft if it was reviewed)');
  }

  async function waive(id: string) {
    const note = window.prompt('Waive note (required)') ?? '';
    if (note.trim().length < 3) return;
    await apiFetch(`/payroll/exceptions/${id}/waive`, {
      method: 'POST',
      body: { note },
    });
    await openRun(active!.id);
  }

  async function download(format: string) {
    if (!active) return;
    const res = await fetch(
      `${API_URL}/payroll/runs/${active.id}/export?format=${format}`,
      { headers: { Authorization: `Bearer ${accessToken() ?? ''}` } },
    );
    if (!res.ok) {
      setError(`Export failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ??
      `export.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${format}`);
    await openRun(active.id);
  }

  const matrix = useMemo(() => {
    if (!active)
      return {
        days: [] as string[],
        rows: [] as {
          name: string;
          cells: Record<string, string>;
          gross: number;
          workerId: string;
        }[],
      };
    const daySet = new Set<string>();
    for (const l of active.lines) {
      for (const d of l.detail?.days ?? []) daySet.add(d.day);
    }
    const days = [...daySet].sort();
    const rows = active.lines.map((l) => {
      const cells: Record<string, string> = {};
      for (const d of l.detail?.days ?? []) {
        if (d.status === 'present') cells[d.day] = '✓';
        else if (d.status === 'halfday') cells[d.day] = '◐';
        else if (d.status === 'absent') cells[d.day] = '✗';
        else if (d.status === 'ot_candidate')
          cells[d.day] = `OT+${d.otHoursPaid || ''}`;
        else cells[d.day] = d.status;
      }
      return { name: l.workerName, cells, gross: l.gross, workerId: l.workerId };
    });
    return { days, rows };
  }, [active]);

  const totals = active?.totals ?? {};

  return (
    <AppShell active="payroll" title="Payroll" eyebrow="Run workspace">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <section className="toolbar">
        <button type="button" onClick={() => void startRun()}>
          Start run (last payroll week)
        </button>
      </section>

      <Card title="Runs" description="Select a payroll period to review, approve, or export.">
        <ul className="worker-list">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="linklike"
                onClick={() => void openRun(r.id)}
              >
                {r.periodStart} → {r.periodEnd}
              </button>{' '}
              <span className={`badge status-${r.status}`}>{r.status}</span>
              {r.totals?.gross != null && (
                <span className="muted"> · ₱{Number(r.totals.gross).toLocaleString()}</span>
              )}
            </li>
          ))}
          {runs.length === 0 && <li className="muted">No payroll runs yet.</li>}
        </ul>
      </Card>

      {active && (
        <>
          {(active.blockingExceptions?.length ?? 0) > 0 && (
            <Card
              tone="warning"
              title={`${active.blockingExceptions.length} unresolved blocking exception(s)`}
              description="Resolve or waive these before moving the run forward."
            >
              <ul>
                {active.blockingExceptions.map((e) => (
                  <li key={e.id}>
                    {e.type} · {e.day ?? '—'} · {e.note ?? ''}
                    <button type="button" onClick={() => void waive(e.id)}>
                      Waive
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title={`${active.periodStart} – ${active.periodEnd}`}
            actions={<Badge tone="neutral">{active.status}</Badge>}
          >

            <div className="totals-card">
              <div>
                <strong>{totals.workers ?? 0}</strong>
                <span>workers</span>
              </div>
              <div>
                <strong>{totals.manDays ?? 0}</strong>
                <span>man-days</span>
              </div>
              <div>
                <strong>{totals.otHours ?? 0}</strong>
                <span>OT hrs</span>
              </div>
              <div>
                <strong>
                  ₱{Number(totals.gross ?? 0).toLocaleString('en-PH')}
                </strong>
                <span>gross</span>
              </div>
            </div>

            <div className="toolbar" style={{ padding: '0.5rem 0' }}>
              {active.status === 'draft' && (
                <button type="button" onClick={() => void transition('reviewed')}>
                  Mark Reviewed
                </button>
              )}
              {active.status === 'reviewed' && (
                <button type="button" onClick={() => void transition('approved')}>
                  Approve
                </button>
              )}
              {(active.status === 'approved' || active.status === 'exported') && (
                <>
                  <button type="button" onClick={() => void download('csv')}>
                    Export CSV
                  </button>
                  <button type="button" onClick={() => void download('xlsx')}>
                    Export Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => void download('signature-pdf')}
                  >
                    Signature PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => void download('payslips-zip')}
                  >
                    Payslips PDF
                  </button>
                </>
              )}
            </div>

            <div className="matrix-wrap">
              <table className="data-table matrix">
                <thead>
                  <tr>
                    <th>Worker</th>
                    {matrix.days.map((d) => (
                      <th key={d}>{d.slice(5)}</th>
                    ))}
                    <th>Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((r) => (
                    <tr key={r.name}>
                      <td>
                        <Link to={`/attendance`}>{r.name}</Link>
                      </td>
                      {matrix.days.map((d) => (
                        <td key={d} className="cell">
                          {r.cells[d] ?? '·'}
                        </td>
                      ))}
                      <td>₱{r.gross.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {active.status !== 'approved' && active.status !== 'exported' && (
              <form
                className="edit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addAdjustment();
                }}
              >
                <h3>Add adjustment</h3>
                <label>
                  Worker
                  <select
                    value={adjWorker}
                    onChange={(e) => setAdjWorker(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {active.lines.map((l) => (
                      <option key={l.workerId} value={l.workerId}>
                        {l.workerName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount (negative = cash advance)
                  <input
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    type="number"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  Note
                  <input
                    value={adjNote}
                    onChange={(e) => setAdjNote(e.target.value)}
                    required
                    minLength={3}
                  />
                </label>
                <button type="submit">Add</button>
              </form>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}
