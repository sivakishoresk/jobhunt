'use client';
import { useState } from 'react';

export function LoginForm({ signupOpen }: { signupOpen: boolean }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const up = mode === 'up';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (up && pw !== pw2) {
      setError('The two passwords are different.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(up ? '/api/signup' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: pw }),
      });
      if (res.ok) {
        window.location.href = '/';
        return;
      }
      setError((await res.json().catch(() => ({}))).error ?? 'Something went wrong. Try again.');
    } catch {
      setError('Could not reach the server. Check your connection.');
    }
    setBusy(false);
  }

  return (
    <main className="login">
      <form onSubmit={submit} noValidate={false}>
        <h1 className="brand">
          Job<span>hunt</span>
        </h1>
        <p className="lede">Your job search, with Claude as the writing desk.</p>

        {signupOpen && (
          <div className="seg" role="tablist" aria-label="Sign in or create an account">
            <button type="button" role="tab" aria-selected={!up} onClick={() => { setMode('in'); setError(''); }}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={up} onClick={() => { setMode('up'); setError(''); }}>
              Create account
            </button>
          </div>
        )}

        <label className="field" htmlFor="un">
          Username
        </label>
        <input id="un" type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />
        {up && <p className="hint">3 to 30 letters, numbers, dots, dashes or underscores.</p>}
        <label className="field" htmlFor="pw">
          Password
        </label>
        <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={up ? 'new-password' : 'current-password'} required />
        {up && (
          <>
            <p className="hint">At least 8 characters.</p>
            <label className="field" htmlFor="pw2">
              Repeat password
            </label>
            <input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
          </>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary block" style={{ marginTop: '1.2rem' }} disabled={busy}>
          {busy ? (up ? 'Creating account…' : 'Signing in…') : up ? 'Create account' : 'Sign in'}
        </button>
        {!up && <p className="hint forgot">Forgot your password? Contact SK to change it.</p>}
        {up && <p className="hint forgot">Your jobs, searches and drafts are private to your account. Forgot your password later? Contact SK to change it.</p>}
      </form>
    </main>
  );
}
