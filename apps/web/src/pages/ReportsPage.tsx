import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api';
import { accessToken } from '../lib/auth';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** E8-S12–S16: attendance / OT / exception reports + padding + evidence pack. */
export default function ReportsPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [attendance, setAttendance] = useState<{
    items: { workerName: string; siteName: string; day: string; status: string; hours: number }[];
    totals: { rows: number; present: number; halfday: number; hours: number };
  } | null>(null);
  const [ot, setOt] = useState<{
    photoOt: { workerName: string; day: string; otHours: number }[];
    manualOt: { workerName: string; day: string; deltaHours: number; reason: string }[];
  } | null>(null);
  const [trends, setTrends] = useState<{
    byType: { type: string; count: number; medianResolveSeconds: number | null }[];
    byEngineer: { engineerEmail: string; count: number }[];
  } | null>(null);
  const [padding, setPadding] = useState<{
    mostManuallyTagged: { workerName: string; count: number; workerId: string }[];
    geofenceFlagsByEngineer: { engineerEmail: string; count: number }[];
    perfectAttendanceAnomalies: { workerName: string; days: number; workerId: string }[];
    otConcentrationByEngineer: { engineerEmail: string; count: number }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = `from=${from}&to=${to}`;
      const [a, o, t, p] = await Promise.all([
        apiFetch<typeof attendance>(`/dashboard/reports/attendance?${q}`),
        apiFetch<typeof ot>(`/dashboard/reports/ot?${q}`),
        apiFetch<typeof trends>(`/dashboard/reports/exceptions?${q}`),
        apiFetch<typeof padding>('/dashboard/padding'),
      ]);
      setAttendance(a);
      setOt(o);
      setTrends(t);
      setPadding(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    }
  }, [from, to]);

  function downloadCsv() {
    if (!attendance) return;
    const header = 'Worker,Site,Day,Status,Hours\n';
    const rows = attendance.items
      .map(
        (i) =>
          `${csv(i.workerName)},${csv(i.siteName ?? '')},${i.day},${i.status},${i.hours}`,
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function evidencePack(workerId: string) {
    const res = await fetch(`${API_URL}/dashboard/evidence-pack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken() ?? ''}`,
      },
      body: JSON.stringify({ workerId }),
    });
    if (!res.ok) {
      setError(`Evidence pack failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence-${workerId.slice(0, 8)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page-pad">
      {error && <p className="error" style={{ padding: '0 1.2rem' }}>{error}</p>}

      <section className="toolbar">
        <label>
          From{' '}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To{' '}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" onClick={() => void load()}>
          Run reports
        </button>
        {attendance && (
          <button type="button" onClick={downloadCsv}>
            Download attendance CSV
          </button>
        )}
      </section>

      {padding && (
        <section className="card-block">
          <h2>Padding indicators</h2>
          <div className="headcount-grid">
            <div className="headcount-card">
              <strong>Most manually tagged</strong>
              <ul className="muted">
                {padding.mostManuallyTagged.map((w) => (
                  <li key={w.workerId}>
                    {w.workerName} ({w.count}){' '}
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => void evidencePack(w.workerId)}
                    >
                      evidence
                    </button>
                  </li>
                ))}
                {padding.mostManuallyTagged.length === 0 && <li>—</li>}
              </ul>
            </div>
            <div className="headcount-card">
              <strong>Geofence flags by engineer</strong>
              <ul className="muted">
                {padding.geofenceFlagsByEngineer.map((e) => (
                  <li key={e.engineerEmail}>
                    {e.engineerEmail} ({e.count})
                  </li>
                ))}
                {padding.geofenceFlagsByEngineer.length === 0 && <li>—</li>}
              </ul>
            </div>
            <div className="headcount-card">
              <strong>Perfect-attendance anomalies</strong>
              <ul className="muted">
                {padding.perfectAttendanceAnomalies.map((w) => (
                  <li key={w.workerId}>
                    {w.workerName} ({w.days} days){' '}
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => void evidencePack(w.workerId)}
                    >
                      evidence
                    </button>
                  </li>
                ))}
                {padding.perfectAttendanceAnomalies.length === 0 && <li>—</li>}
              </ul>
            </div>
            <div className="headcount-card">
              <strong>OT concentration by engineer</strong>
              <ul className="muted">
                {padding.otConcentrationByEngineer.map((e) => (
                  <li key={e.engineerEmail}>
                    {e.engineerEmail} ({e.count})
                  </li>
                ))}
                {padding.otConcentrationByEngineer.length === 0 && <li>—</li>}
              </ul>
            </div>
          </div>
        </section>
      )}

      {attendance && (
        <section className="card-block">
          <h2>
            Attendance summary · {attendance.totals.present} present ·{' '}
            {attendance.totals.halfday} halfday · {attendance.totals.hours.toFixed(1)}h
          </h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Site</th>
                <th>Day</th>
                <th>Status</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {attendance.items.slice(0, 100).map((r, i) => (
                <tr key={i}>
                  <td>{r.workerName}</td>
                  <td>{r.siteName}</td>
                  <td>{r.day}</td>
                  <td>{r.status}</td>
                  <td>{r.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {ot && (
        <section className="card-block">
          <h2>OT report</h2>
          <h3>Photo-verified OT</h3>
          <ul className="muted">
            {ot.photoOt.map((r, i) => (
              <li key={i}>
                {r.workerName} · {r.day} · +{r.otHours}h
              </li>
            ))}
            {ot.photoOt.length === 0 && <li>None</li>}
          </ul>
          <h3>Manual OT adjustments</h3>
          <ul className="muted">
            {ot.manualOt.map((r, i) => (
              <li key={i}>
                {r.workerName} · {r.day} · {r.deltaHours}h — {r.reason}{' '}
                <span className="badge">manual</span>
              </li>
            ))}
            {ot.manualOt.length === 0 && <li>None</li>}
          </ul>
        </section>
      )}

      {trends && (
        <section className="card-block">
          <h2>Exception trends</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Count</th>
                <th>Median resolve (s)</th>
              </tr>
            </thead>
            <tbody>
              {trends.byType.map((t) => (
                <tr key={t.type}>
                  <td>{t.type}</td>
                  <td>{t.count}</td>
                  <td>
                    {t.medianResolveSeconds == null
                      ? '—'
                      : Math.round(t.medianResolveSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>By engineer</h3>
          <ul className="muted">
            {trends.byEngineer.map((e) => (
              <li key={e.engineerEmail}>
                {e.engineerEmail}: {e.count}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function csv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
