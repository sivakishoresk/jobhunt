'use client';
import { useState } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (res.ok) {
      window.location.href = '/';
      return;
    }
    setError((await res.json().catch(() => ({}))).error ?? 'Could not sign in.');
    setBusy(false);
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1 className="brand">
          Job<span>hunt</span>
        </h1>
        <p className="lede">Your job search, with Claude as the writing desk.</p>
        <label className="field" htmlFor="pw">
          Password
        </label>
        <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus required />
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <p>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </p>
      </form>
    </main>
  );
}
