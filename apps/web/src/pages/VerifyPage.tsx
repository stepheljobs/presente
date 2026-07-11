import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { resendOtp, verifyOtp } from '../lib/auth';

export default function VerifyPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  // Arriving here without a sign-up email means a stale/direct visit.
  if (!email) return <Navigate to="/signup" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(email!, code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError(null);
    setNotice(null);
    try {
      await resendOtp(email!);
      setNotice('A new code is on its way.');
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend');
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Check your email</h1>
        <p className="tagline">
          We sent a 6-digit code to <strong>{email}</strong>.
        </p>
        <label>
          Verification code
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <p className="alt-action">
          Didn’t get it?{' '}
          <button type="button" className="linklike" onClick={onResend}>
            Resend code
          </button>
        </p>
      </form>
    </main>
  );
}
