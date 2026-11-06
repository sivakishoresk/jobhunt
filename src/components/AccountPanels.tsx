'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, useToast } from './bits';

interface Me {
  username: string;
  isOwner: boolean;
  apify: { source: 'own' | 'server' | 'none'; last4: string | null };
}
interface UserRow {
  id: string;
  username: string;
  isOwner: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  jobs: number;
  searches: number;
  applications: number;
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');

export function AccountPanels({ onApify }: { onApify?: (hasToken: boolean) => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const { show, node } = useToast();

  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/api/me');
      setMe(m);
      onApify?.(m.apify.source !== 'none');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not load your account.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!me) return null;
  return (
    <>
      <PasswordSection me={me} show={show} />
      <ApifySection me={me} reload={load} show={show} />
      {me.isOwner && <UsersSection show={show} />}
      {node}
    </>
  );
}

type Show = (msg: string) => void;

function PasswordSection({ me, show }: { me: Me; show: Show }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (next !== again) return setErr('The two new passwords are different.');
    setBusy(true);
    try {
      await api('/api/account/password', { method: 'POST', json: { current: cur, next } });
      setCur('');
      setNext('');
      setAgain('');
      show('Password changed. Other devices and Claude will need to sign in again.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Account</h2>
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          Signed in as <b>{me.username}</b>
          {me.isOwner && <span className="badge">Owner</span>}. Your jobs, searches, profile and drafts are visible only to you.
        </p>
        <form onSubmit={save} style={{ maxWidth: '24rem' }}>
          <label className="field" htmlFor="pw-cur">Current password</label>
          <input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          <label className="field" htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
          <label className="field" htmlFor="pw-again">Repeat new password</label>
          <input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} />
          {err && <p className="err" role="alert">{err}</p>}
          <p><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></p>
        </form>
      </div>
    </section>
  );
}

function ApifySection({ me, reload, show }: { me: Me; reload: () => Promise<void>; show: Show }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const a = me.apify;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/account/apify', { method: 'PUT', json: { token } });
      setToken('');
      await reload();
      show('Apify token saved.');
    } catch (err) {
      show(err instanceof Error ? err.message : 'Could not save the token.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api('/api/account/apify', { method: 'DELETE' });
      await reload();
      show('Apify token removed.');
    } catch (err) {
      show(err instanceof Error ? err.message : 'Could not remove the token.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Your Apify account</h2>
      <div className="panel">
        {a.source === 'none' && (
          <p className="notice" style={{ marginTop: 0 }}>
            Searches run on your own Apify account, and you have not added a token yet. Until you do, searching is off. Get a token in Apify Console under <b>Settings → API &amp; Integrations</b>.
          </p>
        )}
        {a.source === 'own' && <p style={{ marginTop: 0 }}>Searches use your token ending in <b>{a.last4}</b>. Apify bills your account for every listing returned.</p>}
        {a.source === 'server' && <p style={{ marginTop: 0 }}>Searches use this server&apos;s shared Apify token. Add your own below to use a different account.</p>}
        <form onSubmit={save} style={{ maxWidth: '30rem' }}>
          <label className="field" htmlFor="apify-token">{a.source === 'own' ? 'Replace token' : 'Apify API token'}</label>
          <div className="copyrow">
            <input id="apify-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="apify_api_…" required />
            <button className="btn" disabled={busy}>Save</button>
          </div>
        </form>
        {a.source === 'own' && (
          <p style={{ marginBottom: 0 }}>
            <button className="btn quiet small danger" onClick={remove} disabled={busy}>Remove my token</button>
          </p>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>The token is stored encrypted and is never shown again or given to Claude.</p>
      </div>
    </section>
  );
}

function UsersSection({ show }: { show: Show }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [pw, setPw] = useState('');

  const load = useCallback(async () => {
    try {
      setUsers((await api<{ users: UserRow[] }>('/api/admin/users')).users);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not load users.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function reset(id: string) {
    try {
      await api(`/api/admin/users/${id}`, { method: 'PATCH', json: { password: pw } });
      setResetting(null);
      setPw('');
      show('New password set. Tell the person; they can change it in Settings.');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not set the password.');
    }
  }
  async function remove(u: UserRow) {
    if (!window.confirm(`Delete ${u.username} and all their jobs, searches and drafts? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      await load();
      show(`${u.username} deleted.`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not delete the account.');
    }
  }

  return (
    <section>
      <h2>People</h2>
      <div className="panel">
        <p style={{ marginTop: 0 }}>Only you can see this list. People who forget their password are told to contact you; set a new one here. You see counts, never anyone&apos;s jobs or profile.</p>
        {!users ? (
          <p className="hint">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table className="users">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Joined</th>
                  <th>Last sign-in</th>
                  <th className="num">Jobs</th>
                  <th className="num">Searches</th>
                  <th className="num">Drafts</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.username}</b>
                      {u.isOwner && <span className="badge">Owner</span>}
                    </td>
                    <td>{day(u.createdAt)}</td>
                    <td>{day(u.lastLoginAt)}</td>
                    <td className="num">{u.jobs}</td>
                    <td className="num">{u.searches}</td>
                    <td className="num">{u.applications}</td>
                    <td className="acts">
                      {resetting === u.id ? (
                        <span className="copyrow" style={{ justifyContent: 'flex-end' }}>
                          <input type="text" aria-label={`New password for ${u.username}`} placeholder="New password (8+)" value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: '12rem' }} autoComplete="off" />
                          <button className="btn small primary" onClick={() => reset(u.id)} disabled={pw.length < 8}>Set</button>
                          <button className="btn small quiet" onClick={() => { setResetting(null); setPw(''); }}>Cancel</button>
                        </span>
                      ) : (
                        <>
                          <button className="btn small" onClick={() => { setResetting(u.id); setPw(''); }}>Reset password</button>{' '}
                          {!u.isOwner && <button className="btn small quiet danger" onClick={() => remove(u)}>Delete</button>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
