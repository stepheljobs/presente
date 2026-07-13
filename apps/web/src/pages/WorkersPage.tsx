import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, AppShell, Card } from '../components/ui';
import { apiFetch } from '../lib/api';
import { currentUser } from '../lib/auth';

interface Worker {
  id: string;
  fullName: string;
  nickname: string | null;
  position: string | null;
  phone: string | null;
  dailyRate: number | null;
  startDate: string | null;
  status: 'active' | 'pending_approval' | 'deactivated';
  biometricStatus: 'none' | 'pending' | 'enrolled';
  noBiometricConsent: boolean;
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

type Draft = {
  id?: string;
  fullName: string;
  nickname: string;
  position: string;
  dailyRate: string;
  phone: string;
  startDate: string;
  noBiometricConsent: boolean;
};

const PAGE_SIZE = 50;

const EMPTY_DRAFT: Draft = {
  fullName: '',
  nickname: '',
  position: '',
  dailyRate: '',
  phone: '',
  startDate: '',
  noBiometricConsent: false,
};

function workerToDraft(w: Worker): Draft {
  return {
    id: w.id,
    fullName: w.fullName,
    nickname: w.nickname ?? '',
    position: w.position ?? '',
    dailyRate: w.dailyRate !== null && w.dailyRate !== undefined ? String(w.dailyRate) : '',
    phone: w.phone ?? '',
    startDate: w.startDate ? w.startDate.slice(0, 10) : '',
    noBiometricConsent: Boolean(w.noBiometricConsent),
  };
}

/** Shape body for POST/PUT — omit empty optionals. */
function draftToBody(draft: Draft, mode: 'create' | 'update') {
  const body: Record<string, unknown> = {
    fullName: draft.fullName.trim(),
  };
  if (draft.nickname.trim()) body.nickname = draft.nickname.trim();
  if (draft.position.trim()) body.position = draft.position.trim();
  if (draft.phone.trim()) body.phone = draft.phone.trim();
  if (draft.startDate) body.startDate = draft.startDate;
  if (draft.dailyRate !== '') {
    const n = Number(draft.dailyRate);
    if (!Number.isNaN(n) && n >= 0) body.dailyRate = n;
  }
  if (mode === 'create') {
    body.noBiometricConsent = draft.noBiometricConsent;
  }
  return body;
}

export default function WorkersPage() {
  const user = currentUser()!;
  const canEdit = user.role === 'owner' || user.role === 'admin';

  const [data, setData] = useState<WorkerPage | null>(null);
  const [pending, setPending] = useState<Worker[]>([]);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const mode = draft.id ? 'update' : 'create';
      const body = draftToBody(draft, mode);
      if (typeof body.fullName !== 'string' || body.fullName.length < 2) {
        throw new Error('Full name must be at least 2 characters');
      }
      await apiFetch(draft.id ? `/workers/${draft.id}` : '/workers', {
        method: draft.id ? 'PUT' : 'POST',
        body,
      });
      setNotice(draft.id ? `${draft.fullName} updated` : `${draft.fullName} added`);
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      active="workers"
      title="Workers"
      eyebrow="Roster and enrollment"
      actions={
        canEdit && !draft ? (
          <button type="button" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            Add worker
          </button>
        ) : null
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {notice && !draft && <Alert tone="success">{notice}</Alert>}

      {draft && canEdit && (
        <form className="worker-form" onSubmit={(e) => void onSubmit(e)}>
          <h3>{draft.id ? `Edit ${draft.fullName || 'worker'}` : 'New worker'}</h3>

          <label className="field">
            Full name *
            <input
              value={draft.fullName}
              onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
              minLength={2}
              required
              autoFocus
            />
          </label>

          <label className="field">
            Nickname
            <input
              value={draft.nickname}
              onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
              placeholder="Optional"
            />
          </label>

          <label className="field">
            Position / trade
            <input
              value={draft.position}
              onChange={(e) => setDraft({ ...draft, position: e.target.value })}
              placeholder="e.g. Mason, Carpenter"
            />
          </label>

          <label className="field">
            Daily rate ₱
            <input
              type="number"
              min={0}
              step={1}
              value={draft.dailyRate}
              onChange={(e) => setDraft({ ...draft, dailyRate: e.target.value })}
              placeholder="0"
            />
          </label>

          <label className="field">
            Phone
            <input
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="+63…"
            />
          </label>

          <label className="field">
            Start date
            <input
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            />
          </label>

          {!draft.id ? (
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={draft.noBiometricConsent}
                onChange={(e) =>
                  setDraft({ ...draft, noBiometricConsent: e.target.checked })
                }
              />
              <span>Manual attendance only (no face enrollment)</span>
            </label>
          ) : (
            draft.noBiometricConsent && (
              <p className="hint muted">
                This worker is on the manual-attendance path (no biometrics).
              </p>
            )
          )}

          <div className="form-actions">
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Save worker'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setDraft(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {pending.length > 0 && (
        <section className="approval-section">
          <h3>Pending approval ({pending.length})</h3>
          {pending.map((w) => (
            <ApprovalCard key={w.id} worker={w} onAction={act} />
          ))}
        </section>
      )}

      <CsvImport onImported={() => refresh()} />

      <Card title={`All workers ${data ? `(${data.total})` : ''}`}>
        <ul className="worker-list">
          {data?.items.map((w) => (
            <WorkerRow
              key={w.id}
              worker={w}
              canEdit={canEdit}
              onEdit={() => {
                setError(null);
                setNotice(null);
                setDraft(workerToDraft(w));
              }}
              onAction={act}
            />
          ))}
          {data && data.items.length === 0 && (
            <li className="muted">
              No workers yet — use <strong>Add worker</strong> or import a CSV.
            </li>
          )}
        </ul>
        {data && data.total > PAGE_SIZE && (
          <div className="pager">
            <button
              type="button"
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
              type="button"
              className="secondary"
              disabled={page >= Math.ceil(data.total / PAGE_SIZE)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </Card>
    </AppShell>
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
          {worker.position ?? 'No position'} · face: {worker.biometricStatus}
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
            type="button"
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
          <button
            type="button"
            className="secondary"
            onClick={() => setRejecting(true)}
          >
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
            type="button"
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
          <button
            type="button"
            className="secondary"
            onClick={() => setRejecting(false)}
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}

function WorkerRow({
  worker,
  canEdit,
  onEdit,
  onAction,
}: {
  worker: Worker;
  canEdit: boolean;
  onEdit: () => void;
  onAction: (fn: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<'deactivate' | 'biometrics' | null>(
    null,
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  return (
    <li className={worker.status === 'deactivated' ? 'archived' : ''}>
      <div>
        <strong>{worker.fullName}</strong>
        {worker.nickname && <span className="muted"> “{worker.nickname}”</span>}
        <div className="muted">
          {worker.position ?? '—'}
          {worker.dailyRate !== null &&
            worker.dailyRate !== undefined &&
            ` · ₱${worker.dailyRate}/day`}
          {` · face: ${worker.biometricStatus}`}
          {worker.noBiometricConsent && ' · manual only'}
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
              type="button"
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
            <button
              type="button"
              className="secondary"
              onClick={() => setConfirming(null)}
            >
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
              type="button"
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
            <button
              type="button"
              className="secondary"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {worker.status !== 'pending_approval' && confirming === null && (
        <div className="row-actions">
          {canEdit && (
            <button type="button" className="secondary" onClick={onEdit}>
              Edit
            </button>
          )}
          {canEdit && worker.status === 'active' && (
            <button
              type="button"
              className="secondary"
              onClick={() => setConfirming('deactivate')}
            >
              Deactivate
            </button>
          )}
          {canEdit && worker.biometricStatus !== 'none' && (
            <button
              type="button"
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
                type="button"
                disabled={
                  busy || result.errors.length > 0 || result.valid === 0 || !csv
                }
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
