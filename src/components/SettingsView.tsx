'use client';
import { useEffect, useState } from 'react';
import type { Preset, SourceConfig } from '@/lib/sources';
import { api, useToast } from './bits';
import { AccountPanels } from './AccountPanels';

interface Row extends SourceConfig {
  inputText: string;
}
interface TestResult {
  status: 'running' | 'done' | 'failed';
  runId?: string;
  error?: string;
  input?: unknown;
  count?: number;
  raw?: unknown;
  normalized?: unknown[];
}

export function SettingsView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [tokenSet, setTokenSet] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState('');
  const [tests, setTests] = useState<Record<string, TestResult | 'busy'>>({});
  const [testKw, setTestKw] = useState('machine learning engineer');
  const [testLoc, setTestLoc] = useState('');
  const { show, node } = useToast();

  useEffect(() => {
    setOrigin(window.location.origin);
    api<{ sources: SourceConfig[]; presets: Preset[]; apifyTokenSet: boolean }>('/api/sources')
      .then((r) => {
        setRows(r.sources.map((s) => ({ ...s, inputText: JSON.stringify(s.input, null, 2) })));
        setPresets(r.presets);
        setTokenSet(r.apifyTokenSet);
      })
      .catch((e) => show(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!rows) return <div className="page">Loading…</div>;
  const mcp = `${origin}/api/mcp`;
  const patch = (i: number, p: Partial<Row>) => {
    setRows((r) => r!.map((x, k) => (k === i ? { ...x, ...p } : x)));
    setDirty(true);
  };

  function parsed(): SourceConfig[] | null {
    try {
      return rows!.map(({ inputText, ...s }) => ({ ...s, input: JSON.parse(inputText) }));
    } catch {
      show('One of the input templates is not valid JSON.');
      return null;
    }
  }

  async function save() {
    const list = parsed();
    if (!list) return;
    setSaving(true);
    try {
      const r = await api<{ sources: SourceConfig[] }>('/api/sources', { method: 'PUT', json: list });
      setRows(r.sources.map((s) => ({ ...s, inputText: JSON.stringify(s.input, null, 2) })));
      setDirty(false);
      show('Sources saved.');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function runTest(i: number) {
    const list = parsed();
    if (!list) return;
    const s = list[i];
    setTests((t) => ({ ...t, [s.id]: 'busy' }));
    try {
      let res = await api<TestResult>('/api/sources/test', { method: 'POST', json: { source: s, keywords: testKw, location: testLoc } });
      setTests((t) => ({ ...t, [s.id]: res }));
      while (res.status === 'running' && res.runId) {
        await new Promise((r) => setTimeout(r, 4000));
        const next = await api<TestResult>(`/api/sources/test?run=${encodeURIComponent(res.runId)}&source=${encodeURIComponent(s.id)}`);
        res = { ...next, input: res.input };
        setTests((t) => ({ ...t, [s.id]: res }));
      }
    } catch (e) {
      setTests((t) => ({ ...t, [s.id]: { status: 'failed', error: e instanceof Error ? e.message : 'Test failed.' } }));
    }
  }

  return (
    <div className="page">
      <h1>Settings</h1>

      <AccountPanels onApify={setTokenSet} />

      <section>
        <h2>Connect Claude</h2>
        <div className="panel">
          <p style={{ marginTop: 0 }}>Add this address as a custom connector so Claude can search, score and draft here.</p>
          <div className="copyrow">
            <input type="text" readOnly value={mcp} aria-label="Connector address" onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={() => navigator.clipboard?.writeText(mcp).then(() => show('Copied.'))}>Copy</button>
          </div>
          <ol>
            <li>In Claude, open <b>Settings → Connectors → Add custom connector</b>.</li>
            <li>Name it Jobhunt, paste the address above, then press <b>Add</b> and <b>Connect</b>.</li>
            <li>Sign in with your Jobhunt username and password on the page that opens, then press <b>Allow access</b>. Claude only sees your own data.</li>
          </ol>
          <p className="hint" style={{ marginBottom: 0 }}>
            Claude Code: <code>claude mcp add --transport http jobhunt {mcp}</code>, then run <code>/mcp</code> to sign in.
          </p>
        </div>
      </section>

      <section>
        <h2>Job sources</h2>
        {!tokenSet && (
          <p className="notice">
            Searching is off until you add your Apify token (see <b>Your Apify account</b> above).
          </p>
        )}
        <p className="hint" style={{ maxWidth: '65ch' }}>
          Each source runs an Apify actor. Actors change over time, so if a source returns nothing or odd fields, use <b>Test</b> to see what the actor sends back and adjust its input below. The values <code>{'{{keywords}}'}</code>, <code>{'{{location}}'}</code>, <code>{'{{maxResults}}'}</code>, <code>{'{{remote}}'}</code>, <code>{'{{linkedinSearchUrl}}'}</code> and <code>{'{{ycRoles}}'}</code> (the Y Combinator role category that fits what you searched for) are filled in for each search.
        </p>
        <div className="grid2" style={{ maxWidth: '40rem' }}>
          <div><label className="field" htmlFor="tk">Test with keywords</label><input id="tk" type="text" value={testKw} onChange={(e) => setTestKw(e.target.value)} /></div>
          <div><label className="field" htmlFor="tl">and place</label><input id="tl" type="text" value={testLoc} onChange={(e) => setTestLoc(e.target.value)} placeholder="Bangalore, India" /></div>
        </div>

        {rows.map((s, i) => {
          const t = tests[s.id];
          const preset = presets.find((p) => p.id === s.preset);
          return (
            <div className="entry" key={s.id}>
              <div className="entry-head">
                <label className="check" style={{ margin: 0 }}>
                  <input type="checkbox" checked={s.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                  <b>{s.label}</b>
                </label>
                {rows.length > 1 && (
                  <button className="btn small quiet danger" onClick={() => { setRows(rows.filter((_, k) => k !== i)); setDirty(true); }}>Remove</button>
                )}
              </div>
              <div className="grid2">
                <div>
                  <label className="field" htmlFor={`l${i}`}>Name</label>
                  <input id={`l${i}`} type="text" value={s.label} onChange={(e) => patch(i, { label: e.target.value })} />
                </div>
                <div>
                  <label className="field" htmlFor={`p${i}`}>Start from a preset</label>
                  <select
                    id={`p${i}`}
                    value={s.preset}
                    onChange={(e) => {
                      const p = presets.find((x) => x.id === e.target.value);
                      if (p) patch(i, { preset: p.id, actor: p.actor, inputText: JSON.stringify(p.input, null, 2), maxResults: p.maxResults, localKeywordFilter: p.localKeywordFilter });
                      else patch(i, { preset: 'custom' });
                    }}
                  >
                    <option value="custom">Custom</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field" htmlFor={`a${i}`}>Apify actor</label>
                  <input id={`a${i}`} type="text" value={s.actor} onChange={(e) => patch(i, { actor: e.target.value, preset: 'custom' })} placeholder="username/actor-name" />
                </div>
                <div>
                  <label className="field" htmlFor={`m${i}`}>Jobs per search</label>
                  <input id={`m${i}`} type="number" min={1} max={500} value={s.maxResults} onChange={(e) => patch(i, { maxResults: Number(e.target.value) })} />
                </div>
              </div>
              {preset && <p className="hint">{preset.note}</p>}
              <label className="check">
                <input type="checkbox" checked={s.localKeywordFilter} onChange={(e) => patch(i, { localKeywordFilter: e.target.checked })} />
                Filter results by my keywords here (for actors that can’t search by keyword)
              </label>
              <label className="field" htmlFor={`i${i}`}>Actor input (JSON)</label>
              <textarea id={`i${i}`} rows={6} spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.85rem' }} value={s.inputText} onChange={(e) => patch(i, { inputText: e.target.value })} />
              <p>
                <button className="btn small" onClick={() => runTest(i)} disabled={t === 'busy' || (typeof t === 'object' && t.status === 'running')}>
                  {t === 'busy' || (typeof t === 'object' && t.status === 'running') ? 'Testing… (can take a minute)' : 'Test with 3 results'}
                </button>
              </p>
              {typeof t === 'object' && (
                <div aria-live="polite">
                  {t.status === 'failed' && <p className="err">{t.error}</p>}
                  {t.status === 'done' && (
                    <>
                      <p className="hint">{t.count} result{t.count === 1 ? '' : 's'} came back. {t.count === 0 && 'Check the input or try broader keywords.'}</p>
                      {t.normalized?.[0] === null && <p className="err">The first result had no title, so it could not be read. Compare the raw item below.</p>}
                      {t.normalized?.[0] != null && (
                        <>
                          <b>How Jobhunt reads the first result</b>
                          <pre className="json">{JSON.stringify(t.normalized[0], null, 2)}</pre>
                        </>
                      )}
                      <details>
                        <summary>Raw item from Apify</summary>
                        <pre className="json">{JSON.stringify(t.raw, null, 2)}</pre>
                      </details>
                    </>
                  )}
                  {t.input !== undefined && (
                    <details>
                      <summary>Input that was sent</summary>
                      <pre className="json">{JSON.stringify(t.input, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button className="btn small" onClick={() => { setRows([...rows, { id: `src-${Math.random().toString(36).slice(2, 7)}`, label: 'New source', enabled: false, preset: 'custom', actor: '', input: {}, inputText: '{\n  \n}', maxResults: 25, localKeywordFilter: false }]); setDirty(true); }}>
          Add a source
        </button>
      </section>

      <div className="savebar">
        <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save sources'}</button>
        <span className="hint">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      </div>
      {node}
    </div>
  );
}
