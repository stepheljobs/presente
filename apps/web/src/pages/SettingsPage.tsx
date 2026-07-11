import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { currentUser } from '../lib/auth';

interface Settings {
  workdays: number[];
  standardWorkdayHours: number;
  otMultiplier: number;
  lateGraceMinutes: number;
  halfdayRule: 'hours_threshold' | 'cutoff_time';
  halfdayThresholdHours: number;
  halfdayCutoffTime: string;
  payrollWeekStartDay: number;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function SettingsPage() {
  const user = currentUser()!;
  const readOnly = user.role !== 'owner';
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Settings>('/settings').then(setSettings).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    });
  }, []);

  if (error && !settings) return <p className="error page-pad">{error}</p>;
  if (!settings) return <p className="page-pad">Loading…</p>;

  const otPercent = Math.round(settings.otMultiplier * 100);

  function patch(update: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...update } : s));
    setToast(null);
  }

  function toggleDay(day: number) {
    const has = settings!.workdays.includes(day);
    const next = has
      ? settings!.workdays.filter((d) => d !== day)
      : [...settings!.workdays, day].sort();
    if (next.length > 0) patch({ workdays: next });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const saved = await apiFetch<Settings>('/settings', {
        method: 'PUT',
        body: settings,
      });
      setSettings(saved);
      setToast('Settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-pad settings-page">
      <nav className="crumbs">
        <Link to="/">← Dashboard</Link>
      </nav>
      <h2>Company settings</h2>
      {readOnly && (
        <p className="notice">Only the Owner can change these settings.</p>
      )}
      <form onSubmit={onSubmit} className="settings-form">
        <fieldset disabled={readOnly || busy}>
          <label className="field">
            Work week
            <div className="day-row">
              {DAY_NAMES.map((name, i) => (
                <label key={name} className="day-check">
                  <input
                    type="checkbox"
                    checked={settings.workdays.includes(i + 1)}
                    onChange={() => toggleDay(i + 1)}
                  />
                  {name}
                </label>
              ))}
            </div>
          </label>

          <label className="field">
            Standard workday (hours)
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={settings.standardWorkdayHours}
              onChange={(e) =>
                patch({ standardWorkdayHours: Number(e.target.value) })
              }
            />
          </label>

          <label className="field">
            Overtime multiplier (%)
            <input
              type="number"
              min={100}
              max={500}
              step={5}
              value={otPercent}
              onChange={(e) =>
                patch({ otMultiplier: Number(e.target.value) / 100 })
              }
            />
          </label>

          <label className="field">
            Late grace period (minutes)
            <input
              type="number"
              min={0}
              max={240}
              value={settings.lateGraceMinutes}
              onChange={(e) =>
                patch({ lateGraceMinutes: Number(e.target.value) })
              }
            />
          </label>

          <div className="field">
            Halfday rule
            <label className="radio-row">
              <input
                type="radio"
                checked={settings.halfdayRule === 'hours_threshold'}
                onChange={() => patch({ halfdayRule: 'hours_threshold' })}
              />
              Fewer than
              <input
                type="number"
                className="inline-num"
                min={0.5}
                max={12}
                step={0.5}
                value={settings.halfdayThresholdHours}
                onChange={(e) =>
                  patch({ halfdayThresholdHours: Number(e.target.value) })
                }
                disabled={settings.halfdayRule !== 'hours_threshold'}
              />
              hours worked
            </label>
            <label className="radio-row">
              <input
                type="radio"
                checked={settings.halfdayRule === 'cutoff_time'}
                onChange={() => patch({ halfdayRule: 'cutoff_time' })}
              />
              Time-in after
              <input
                type="time"
                className="inline-num"
                value={settings.halfdayCutoffTime}
                onChange={(e) => patch({ halfdayCutoffTime: e.target.value })}
                disabled={settings.halfdayRule !== 'cutoff_time'}
              />
            </label>
          </div>

          <label className="field">
            Payroll week starts on
            <select
              value={settings.payrollWeekStartDay}
              onChange={(e) =>
                patch({ payrollWeekStartDay: Number(e.target.value) })
              }
            >
              {DAY_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          {error && <p role="alert" className="error">{error}</p>}
          {toast && <p className="notice" role="status">{toast}</p>}
          {!readOnly && (
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          )}
        </fieldset>
      </form>
    </main>
  );
}
