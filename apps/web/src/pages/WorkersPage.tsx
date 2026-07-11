import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';

interface Worker {
  id: string;
  fullName: string;
  nickname: string | null;
  position: string | null;
  phone: string | null;
  dailyRate: number | null;
  status: 'active' | 'pending_approval' | 'deactivated';
  biometricStatus: 'none' | 'pending' | 'enrolled';
  endDate: string | null;
  retentionUntil: string | null;
}

interface WorkerPage {
  total: number;
  page: number;
  pageSize: number;
  items: Worker[];
}

interface CsvResult {
  dryRun: boolean;
  valid: number;
  errors: { line: number; reason: string }[];
  imported: number;
}

const PAGE_SIZE = 50;

export default function WorkersPage() {
  const [data, setData] = useState<WorkerPage | null>(null);
  const [pending, setPending] = useState<Worker[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [all, pend] = await Promise.all([
      apiFetch<WorkerPage>(`/workers?page=${page}&pageSize=${PAGE_SIZE}`),
      apiFetch<WorkerPage>(`/workers?status=pending_approval&pageSize=100`),
    ]);
    setData(all);
    setPending(pend.items);
  }, [page]);

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : 'Failed to load workers'),
    );
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  return (
    <main className="page-pad workers-page">
      <nav className="crumbs">
        <Link to="/">← Dashboard</Link>
      </nav>
      <h2>Workers</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {pending.length > 0 && (
        <section className="approval-section">
          <h3>Pending approval ({pending.length})</h3>
          {pending.map((w) => (
            <ApprovalCard key={w.id} worker={w} onAction={act} />
          ))}
        </section>
      )}

      <CsvImport onImported={() => refresh()} />

      <h3>
        All workers {data ? `(${data.total})` : ''}
      </h3>
      <ul className="worker-list">
        {data?.items.map((w) => (
          <WorkerRow key={w.id} worker={w} onAction={act} />
        ))}
        {data && data.items.length === 0 && (
          <li className="muted">No workers yet — add them via CSV import or the mobile app.</li>
        )}
      </ul>
      {data && data.total > PAGE_SIZE && (
        <div className="pager">
          <button
            className="secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span className="muted">
            Page {page} of {Math.ceil(data.total / PAGE_SIZE)}
          </span>
          <button
            className="secondary"
            disabled={page >= Math.ceil(data.total / PAGE_SIZE)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </main>
  );
}

function ApprovalCard({
  worker,
  onAction,
}: {
  worker: Worker;
  onAction: (fn: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  return (
    <div className="approval-card">
      <div>
        <strong>{worker.fullName}</strong>
        {worker.nickname && <span className="muted"> “{worker.nickname}”</span>}
        <div className="muted">
          {worker.position ?? 'No position'} · face:{' '}
          {worker.biometricStatus}
        </div>
      </div>
      {!rejecting ? (
        <div className="row-actions">
          <input
            type="number"
            min={0}
            placeholder="Daily rate ₱"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="rate-input"
          />
          <button
            disabled={rate === '' || Number(rate) < 0}
            onClick={() =>
              onAction(
                () =>
                  apiFetch(`/workers/${worker.id}/approve`, {
                    method: 'POST',
                    body: { dailyRate: Number(rate) },
                  }),
                `${worker.fullName} approved`,
              )
            }
          >
            Approve
          </button>
          <button className="secondary" onClick={() => setRejecting(true)}>
            Reject…
          </button>
        </div>
      ) : (
        <div className="row-actions">
          <input
            placeholder="Reason (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="danger"
            disabled={note.trim().length < 3}
            onClick={() =>
              onAction(
                () =>
                  apiFetch(`/workers/${worker.id}/reject`, {
                    method: 'POST',
                    body: { note },
                  }),
                `${worker.fullName} rejected`,
              )
            }
          >
            Confirm reject
          </button>
          <button className="secondary" onClick={() => setRejecting(false)}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}

function WorkerRow({
  worker,
  onAction,
}: {
  worker: Worker;
  onAction: (fn: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<'deactivate' | 'biometrics' | null>(null);
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  return (
    <li className={worker.status === 'deactivated' ? 'archived' : ''}>
      <div>
        <strong>{worker.fullName}</strong>
        <div className="muted">
          {worker.position ?? '—'}
          {worker.dailyRate !== null && ` · ₱${worker.dailyRate}/day`}
          {` · face: ${worker.biometricStatus}`}
          {worker.status === 'deactivated' &&
            ` · ended ${worker.endDate}` +
              (worker.retentionUntil
                ? `, biometrics purge due ${worker.retentionUntil.slice(0, 10)}`
                : '')}
        </div>
        {confirming === 'deactivate' && (
          <div className="confirm-strip">
            End date:{' '}
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <button
              className="danger"
              onClick={() => {
                setConfirming(null);
                void onAction(
                  () =>
                    apiFetch(`/workers/${worker.id}/deactivate`, {
                      method: 'POST',
                      body: { endDate },
                    }),
                  `${worker.fullName} deactivated — biometric retention countdown started`,
                );
              }}
            >
              Confirm deactivation
            </button>
            <button className="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        )}
        {confirming === 'biometrics' && (
          <div className="confirm-strip">
            <span>
              Permanently deletes face template and enrollment photos
              (provider-side delete verified). Attendance and payroll records
              are kept. This cannot be undone.
            </span>
            <button
              className="danger"
              onClick={() => {
                setConfirming(null);
                void onAction(
                  () =>
                    apiFetch(`/workers/${worker.id}/biometrics`, {
                      method: 'DELETE',
                    }),
                  `Biometric data for ${worker.fullName} deleted — certificate written to the audit log`,
                );
              }}
            >
              Delete biometric data
            </button>
            <button className="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {worker.status !== 'pending_approval' && confirming === null && (
        <div className="row-actions">
          {worker.status === 'active' && (
            <button
              className="secondary"
              onClick={() => setConfirming('deactivate')}
            >
              Deactivate
            </button>
          )}
          {worker.biometricStatus !== 'none' && (
            <button
              className="secondary"
              onClick={() => setConfirming('biometrics')}
            >
              Delete biometrics…
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** E3-S14: upload → dry-run preview with highlighted errors → commit. */
function CsvImport({ onImported }: { onImported: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<CsvResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function runDryRun(text: string) {
    setBusy(true);
    try {
      const res = await apiFetch<CsvResult>('/workers/import', {
        method: 'POST',
        body: { csv: text, dryRun: true },
      });
      setResult(res);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    await runDryRun(text);
  }

  async function commit() {
    if (!csv) return;
    setBusy(true);
    try {
      const res = await apiFetch<CsvResult>('/workers/import', {
        method: 'POST',
        body: { csv },
      });
      setResult(res);
      setCsv(null);
      setFileName('');
      onImported();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="csv-import">
      <h3>CSV import</h3>
      <p className="muted">
        Columns: <code>name</code> (required), <code>rate</code>,{' '}
        <code>position</code>. Up to 500 rows.
      </p>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      {result && (
        <div className="csv-result">
          {result.imported > 0 ? (
            <p className="notice" role="status">
              Imported {result.imported} workers ✓
            </p>
          ) : (
            <>
              <p>
                {fileName}: <strong>{result.valid}</strong> valid rows,{' '}
                <strong>{result.errors.length}</strong> errors
              </p>
              {result.errors.length > 0 && (
                <ul className="csv-errors">
                  {result.errors.map((e) => (
                    <li key={`${e.line}-${e.reason}`}>
                      Line {e.line}: {e.reason}
                    </li>
                  ))}
                </ul>
              )}
              <button
                disabled={busy || result.errors.length > 0 || result.valid === 0 || !csv}
                onClick={() => void commit()}
              >
                {result.errors.length > 0
                  ? 'Fix errors to import'
                  : `Import ${result.valid} workers`}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
