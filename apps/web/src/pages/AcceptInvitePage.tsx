import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { storeSession } from '../lib/auth';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface InviteInfo {
  email: string;
  role: 'admin' | 'engineer';
  companyName: string;
}

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [engineerDone, setEngineerDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      return;
    }
    fetch(`${API_URL}/invites/token/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setInfo((await res.json()) as InviteInfo);
      })
      .catch(() => setInvalid(true));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/invites/token/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => null)) as {
        accessToken?: string;
        user?: { role: string };
        message?: string | string[];
      } | null;
      if (!res.ok || !body?.accessToken) {
        const message = Array.isArray(body?.message)
          ? body.message[0]
          : body?.message;
        throw new Error(message ?? 'Could not accept the invite');
      }
      if (body.user?.role === 'engineer') {
        // Engineers work in the mobile app, not this dashboard.
        setEngineerDone(true);
      } else {
        storeSession(body.accessToken);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept');
    } finally {
      setBusy(false);
    }
  }

  if (invalid) {
    return (
      <main className="login-page">
        <div className="login-card">
          <h1>Invite not found</h1>
          <p className="tagline">
            This invite link is invalid, expired, or already used. Ask your
            company owner to send a new one.
          </p>
          <p className="alt-action">
            <Link to="/login">Go to sign in</Link>
          </p>
        </div>
      </main>
    );
  }

  if (engineerDone) {
    return (
      <main className="login-page">
        <div className="login-card">
          <h1>You’re in! 🎉</h1>
          <p className="tagline">
            Your password is set. Install the Presente app on your Android
            phone and sign in with <strong>{info?.email}</strong> to start
            capturing attendance.
          </p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="login-page">
        <p>Checking your invite…</p>
      </main>
    );
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Join {info.companyName}</h1>
        <p className="tagline">
          You’ve been invited as <strong>{info.role}</strong> ({info.email}).
          Set a password to finish.
        </p>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Joining…' : 'Join company'}
        </button>
      </form>
    </main>
  );
}
