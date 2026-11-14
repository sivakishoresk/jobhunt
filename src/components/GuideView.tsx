'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeToggle } from './Nav';

/* ───────────────────────── helpers ───────────────────────── */

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function CopyButton({ text, label = 'Copy', small }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${small ? 'small' : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

function PromptBox({ text }: { text: string }) {
  return (
    <div className="g-prompt">
      <p>{text}</p>
      <CopyButton text={text} small />
    </div>
  );
}

/* ───────────────────────── setup steps ───────────────────────── */

interface Step {
  id: string;
  title: string;
  time: string;
  summary: string;
}
const STEPS: Step[] = [
  { id: 'account', title: 'Create your account', time: '1 min', summary: 'A username and a password. Your jobs and drafts stay private to you.' },
  { id: 'apify', title: 'Add your Apify token', time: '3 min', summary: 'Searches run on your own Apify account, which finds the listings.' },
  { id: 'connect', title: 'Connect Claude', time: '2 min', summary: 'Add Jobhunt as a connector once, so Claude can search, score and draft for you.' },
  { id: 'resume', title: 'Give Claude your résumé', time: '1 min', summary: 'Attach it in the chat. Claude fills in your profile for you.' },
  { id: 'search', title: 'Run your first search', time: '2 min', summary: 'Ask for roles in plain words, then ask Claude to score what it finds.' },
];

function StepBody({ id, origin }: { id: string; origin: string }) {
  const url = `${origin}/api/mcp`;
  const [tab, setTab] = useState<'app' | 'code'>('app');
  const [apifyChecks, setApifyChecks] = useState([false, false, false, false]);
  if (id === 'account')
    return (
      <>
        <p>
          Open the <Link href="/login">sign-in page</Link>, choose <b>Create account</b>, and pick a username (3 to 30 letters, numbers, dots, dashes or underscores) and a password of at least 8 characters.
        </p>
        <p className="hint">Forgot your password later? Contact SK, who can set a new one. Everything you have saved stays.</p>
      </>
    );
  if (id === 'apify')
    return (
      <>
        <p>Apify is the service that reads LinkedIn and Y Combinator for you. Jobhunt uses your own Apify account, so the cost is yours and you decide the limits. Tick each step as you go.</p>
        <ul className="g-checks">
          {[
            <>
              Make a free account at <a href="https://apify.com" target="_blank" rel="noreferrer">apify.com</a>.
            </>,
            <>
              In Apify Console open <b>Settings → API &amp; integrations</b>.
            </>,
            <>
              Copy your <b>Personal API token</b>. It starts with <code>apify_api_</code>.
            </>,
            <>
              In Jobhunt open <Link href="/settings">Settings</Link>, find <b>Your Apify account</b>, paste the token and press <b>Save</b>.
            </>,
          ].map((t, i) => (
            <li key={i}>
              <label>
                <input type="checkbox" checked={apifyChecks[i]} onChange={() => setApifyChecks((c) => c.map((v, j) => (j === i ? !v : v)))} />
                <span>{t}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="hint">
          The token is stored encrypted. It is never shown again, and Claude never sees it. A search of about 25 listings per source usually costs a few cents; check <a href="https://apify.com/pricing" target="_blank" rel="noreferrer">Apify&apos;s pricing</a> for current numbers.
        </p>
      </>
    );
  if (id === 'connect')
    return (
      <>
        <p>This address lets Claude talk to your Jobhunt. Copy it:</p>
        <div className="g-url">
          <input readOnly value={url} aria-label="Connector address" onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={url} />
        </div>
        <div className="seg g-seg" role="tablist" aria-label="Where you use Claude">
          <button type="button" role="tab" aria-selected={tab === 'app'} onClick={() => setTab('app')}>
            Claude app or claude.ai
          </button>
          <button type="button" role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
            Claude Code
          </button>
        </div>
        {tab === 'app' ? (
          <ol className="g-ol">
            <li>
              In Claude open <b>Settings → Connectors → Add custom connector</b>.
            </li>
            <li>
              Name it <b>Jobhunt</b>, paste the address, press <b>Add</b>, then <b>Connect</b>.
            </li>
            <li>
              A Jobhunt page opens. Sign in with your Jobhunt username and password and press <b>Allow access</b>.
            </li>
            <li>Start a new chat. Jobhunt is now available to Claude. Claude only sees your own data.</li>
          </ol>
        ) : (
          <>
            <ol className="g-ol">
              <li>Run this in your terminal.</li>
              <li>
                Inside Claude Code type <code>/mcp</code> and follow the sign-in link.
              </li>
            </ol>
            <div className="g-prompt mono">
              <p>{`claude mcp add --transport http jobhunt ${url}`}</p>
              <CopyButton text={`claude mcp add --transport http jobhunt ${url}`} small />
            </div>
          </>
        )}
        <p className="hint">Custom connectors depend on your Claude plan. If you do not see the option in Settings, check your plan or ask your workspace admin.</p>
      </>
    );
  if (id === 'resume')
    return (
      <>
        <ol className="g-ol">
          <li>Open a new chat with Jobhunt connected.</li>
          <li>
            Attach your résumé (PDF or Word) with the paperclip, or paste the text, and send this:
          </li>
        </ol>
        <PromptBox text="Using Jobhunt, read the résumé I attached and fill in my profile. Copy facts exactly, don't add anything that isn't in it, then tell me what looks thin or missing." />
        <p>
          Then open <Link href="/profile">Profile</Link> and check it. Add your email, phone and links there if they are missing: Claude does not see them, and Jobhunt adds them to downloads for you.
        </p>
        <p className="hint">Claude also lists up to five job titles that fit your résumé. Later searches use them when you do not name a role.</p>
      </>
    );
  return (
    <>
      <PromptBox text="Using Jobhunt, find machine learning engineer jobs in Bengaluru posted this week and score them against my profile." />
      <p>
        Claude searches, waits for the results, and scores each job from 0 to 100 with reasons and red flags. Open <Link href="/">Jobs</Link> to see them sorted by fit. Then try: <i>&quot;Draft an application for the second one.&quot;</i>
      </p>
      <p className="hint">Change the role and the place to suit you. You can ask for several of each at once, up to five.</p>
    </>
  );
}

function Setup() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<string>('account');
  const [origin, setOrigin] = useState('https://your-jobhunt-address');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const d = JSON.parse(localStorage.getItem('jh.guide.done') ?? '{}');
      if (d && typeof d === 'object') {
        setDone(d);
        const next = STEPS.find((s) => !d[s.id]);
        if (next) setOpen(next.id);
      }
    } catch {}
    setReady(true);
  }, []);

  const toggle = useCallback((id: string) => {
    setDone((d) => {
      const n = { ...d, [id]: !d[id] };
      try {
        localStorage.setItem('jh.guide.done', JSON.stringify(n));
      } catch {}
      if (n[id]) {
        const i = STEPS.findIndex((s) => s.id === id);
        const next = STEPS.slice(i + 1).find((s) => !n[s.id]);
        if (next) setOpen(next.id);
      }
      return n;
    });
  }, []);

  const count = STEPS.filter((s) => done[s.id]).length;
  return (
    <section id="setup" className="g-sec">
      <header className="g-sec-head">
        <h2>Set up in five steps</h2>
        <p className="g-count" aria-live="polite">
          <span className="g-bar" aria-hidden>
            <i style={{ width: `${(count / STEPS.length) * 100}%` }} />
          </span>
          {ready ? `${count} of ${STEPS.length} done` : ' '}
        </p>
      </header>
      <p className="hint g-note">Your ticks are saved in this browser only. They do not change anything in your account.</p>
      <ol className="g-steps">
        {STEPS.map((s, i) => {
          const isOpen = open === s.id;
          return (
            <li key={s.id} className={`g-step ${done[s.id] ? 'is-done' : ''} ${isOpen ? 'is-open' : ''}`}>
              <div className="g-step-head">
                <button type="button" className="g-step-toggle" aria-expanded={isOpen} aria-controls={`step-${s.id}`} onClick={() => setOpen(isOpen ? '' : s.id)}>
                  <span className="g-num" aria-hidden>
                    {done[s.id] ? (
                      <svg viewBox="0 0 24 24" className="ic">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="g-step-text">
                    <strong>{s.title}</strong>
                    <small>{s.summary}</small>
                  </span>
                  <span className="g-time">{s.time}</span>
                </button>
              </div>
              {isOpen && (
                <div className="g-step-body" id={`step-${s.id}`}>
                  <StepBody id={s.id} origin={origin} />
                  <button type="button" className={`btn ${done[s.id] ? '' : 'primary'}`} onClick={() => toggle(s.id)}>
                    {done[s.id] ? 'Mark as not done' : 'Mark as done'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {ready && count === STEPS.length && (
        <p className="g-finish" role="status">
          You are set up. From here, just talk to Claude. The prompts below are good starting points.
        </p>
      )}
    </section>
  );
}

/* ───────────────────────── try-it demo ───────────────────────── */

interface Tool {
  name: string;
  title: string;
}
interface Scenario {
  id: 'resume' | 'search' | 'score' | 'draft' | 'track';
  tab: string;
  attach?: string;
  prompt: string;
  tools: Tool[];
  reply: string[];
  panelTitle: string;
}
const SCENARIOS: Scenario[] = [
  {
    id: 'resume',
    tab: 'Fill my profile',
    attach: 'Asha_Verma_resume.pdf',
    prompt: 'Using Jobhunt, read the résumé I attached and fill in my profile. Copy facts exactly, then tell me what looks thin.',
    tools: [
      { name: 'get_profile', title: 'Read my profile' },
      { name: 'update_profile', title: 'Update my profile' },
    ],
    reply: [
      'Done. Your profile now has your summary, 9 skills, 2 roles, 1 project and your degree, copied from the résumé as written.',
      'Two things look thin: the Fernleaf bullets have no numbers, and there is no location on the Quillbyte role. Add them on the Profile page if you can. I have not invented any.',
      'I also set three job titles to search for: machine learning engineer, applied scientist, data scientist.',
    ],
    panelTitle: 'Your profile page, afterwards',
  },
  {
    id: 'search',
    tab: 'Search for jobs',
    prompt: 'Find machine learning engineer jobs in Bengaluru posted in the last 7 days. Entry to mid level.',
    tools: [
      { name: 'list_searches', title: 'List past searches' },
      { name: 'search_jobs', title: 'Search for jobs' },
    ],
    reply: [
      'Found 34 listings: 25 from LinkedIn and 9 from Y Combinator. I checked first and you had not run this search before.',
      'They are in your Jobs list now, newest first. Want me to score them against your profile?',
    ],
    panelTitle: 'Your Jobs page, afterwards',
  },
  {
    id: 'score',
    tab: 'Score the results',
    prompt: 'Score the jobs from that search and show me the best three, with reasons.',
    tools: [
      { name: 'jobs_to_score', title: 'Get jobs that need a fit score' },
      { name: 'get_profile', title: 'Read my profile' },
      { name: 'score_jobs', title: 'Save fit scores' },
    ],
    reply: [
      'Scored 34 jobs. Three are strong matches (80 or more). Fernleaf and Brightloom fit your level and your skills; Tessellate wants a senior profile, so I scored it lower and said why.',
      'Click a job on the right to see its reasons and red flags. The same scores now sort your Jobs list.',
    ],
    panelTitle: 'Your Jobs page, sorted by fit (click a job)',
  },
  {
    id: 'draft',
    tab: 'Draft an application',
    prompt: 'Draft an application for the Fernleaf one. Flag every requirement my profile does not cover.',
    tools: [
      { name: 'get_job', title: 'Read a job posting' },
      { name: 'check_draft', title: 'Fact-check a draft' },
      { name: 'save_application', title: 'Save a draft application' },
    ],
    reply: [
      'The draft is saved. I used only what is in your profile, and the fact check found no numbers or skills that are not yours.',
      'Two requirements are not in your profile: Kubernetes in production, and experience with a team of 5 or more. I did not claim them. They are listed under "Gaps Claude found" so you can decide what to say.',
      'Open it in Jobhunt to edit the wording, then download it as PDF or Word.',
    ],
    panelTitle: 'The draft in Applications (try the tabs)',
  },
  {
    id: 'track',
    tab: 'Track progress',
    prompt: 'Mark Fernleaf as sent, and tell me what is still in draft.',
    tools: [
      { name: 'set_application_status', title: 'Update application status' },
      { name: 'list_applications', title: 'List applications' },
    ],
    reply: [
      'Fernleaf is now marked sent. Brightloom is still a draft, and Quillbyte is at interview.',
      'You can also move cards yourself in the Applications board, as on the right.',
    ],
    panelTitle: 'The Applications board (use the buttons)',
  },
];

const ASHA_SKILLS = ['Python', 'PyTorch', 'scikit-learn', 'SQL', 'Docker', 'Transformers', 'MLflow', 'Pandas', 'Git'];

function ProfilePanel() {
  return (
    <div className="g-card g-profile">
      <div className="g-pop" style={{ animationDelay: '0ms' }}>
        <h4>Asha Verma</h4>
        <p className="g-sub">ML engineer · Bengaluru</p>
      </div>
      <p className="g-lbl g-pop" style={{ animationDelay: '150ms' }}>Skills</p>
      <div className="g-chips">
        {ASHA_SKILLS.map((s, i) => (
          <span key={s} className="g-chip g-pop" style={{ animationDelay: `${250 + i * 70}ms` }}>
            {s}
          </span>
        ))}
      </div>
      <p className="g-lbl g-pop" style={{ animationDelay: '950ms' }}>Experience</p>
      <ul className="g-plain">
        <li className="g-pop" style={{ animationDelay: '1050ms' }}>
          <b>ML engineer</b>, Fernleaf AI <span className="g-date">Jul 2023 – Present</span>
        </li>
        <li className="g-pop" style={{ animationDelay: '1200ms' }}>
          <b>Data science intern</b>, Quillbyte <span className="g-date">May 2022 – Jul 2022</span>
        </li>
      </ul>
      <p className="g-lbl g-pop" style={{ animationDelay: '1350ms' }}>Job titles to search</p>
      <div className="g-chips">
        {['Machine learning engineer', 'Applied scientist', 'Data scientist'].map((s, i) => (
          <span key={s} className="g-chip hl g-pop" style={{ animationDelay: `${1450 + i * 90}ms` }}>
            {s}
          </span>
        ))}
      </div>
      <p className="g-callout g-pop" style={{ animationDelay: '1800ms' }}>
        Email, phone and links are blank. Add them here yourself; Claude does not see them.
      </p>
    </div>
  );
}

interface DemoJob {
  id: string;
  title: string;
  company: string;
  place: string;
  score?: number;
  reasons?: string[];
  flags?: string[];
}
const DEMO_JOBS: DemoJob[] = [
  { id: 'a', title: 'Machine learning engineer', company: 'Fernleaf AI', place: 'Bengaluru', score: 88, reasons: ['Your PyTorch and MLflow work matches the stack in the posting.', 'Asks for 1 to 3 years; you have about 3.', 'Based in Bengaluru, same as you.'], flags: ['Mentions Kubernetes; not in your profile.'] },
  { id: 'b', title: 'Applied scientist', company: 'Brightloom', place: 'Bengaluru (hybrid)', score: 82, reasons: ['Role centres on ranking models; your project is close.', 'Level fits.'], flags: ['Wants a published paper; you list none.'] },
  { id: 'c', title: 'Data scientist', company: 'Quillbyte', place: 'Remote, India', score: 67, reasons: ['Skills overlap, mostly SQL and Python.'], flags: ['More analytics than modelling than you want.'] },
  { id: 'd', title: 'Staff ML engineer', company: 'Tessellate Systems', place: 'Bengaluru', score: 31, reasons: ['Topic fits.'], flags: ['Asks for 8+ years and team leadership.', 'Two levels above your experience.'] },
];

function JobsPanel({ scored }: { scored: boolean }) {
  const [openId, setOpenId] = useState<string | null>(scored ? 'a' : null);
  const jobs = useMemo(() => (scored ? [...DEMO_JOBS].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)) : DEMO_JOBS), [scored]);
  return (
    <div className="g-card">
      {!scored && (
        <ul className="g-runs">
          <li className="g-pop" style={{ animationDelay: '0ms' }}>
            <svg className="ic" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> LinkedIn · 25 listings
          </li>
          <li className="g-pop" style={{ animationDelay: '250ms' }}>
            <svg className="ic" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> Y Combinator · 9 listings
          </li>
        </ul>
      )}
      <ul className="g-jobs">
        {jobs.map((j, i) => (
          <li key={j.id} className="g-pop" style={{ animationDelay: `${(scored ? 0 : 500) + i * 140}ms` }}>
            <button type="button" className="g-job" aria-expanded={scored ? openId === j.id : undefined} disabled={!scored} onClick={() => setOpenId(openId === j.id ? null : j.id)}>
              <span className="g-job-main">
                <b>{j.title}</b>
                <small>
                  {j.company} · {j.place}
                </small>
              </span>
              {scored ? (
                <span className={`g-score ${(j.score ?? 0) >= 80 ? 'hi' : (j.score ?? 0) >= 60 ? 'mid' : 'lo'}`}>{j.score}</span>
              ) : (
                <span className="g-new">New</span>
              )}
            </button>
            {scored && openId === j.id && (
              <div className="g-why">
                <p className="g-lbl">Why it fits</p>
                <ul>{j.reasons?.map((r) => <li key={r}>{r}</li>)}</ul>
                <p className="g-lbl flag">Watch out</p>
                <ul>{j.flags?.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DraftPanel() {
  const [tab, setTab] = useState<'resume' | 'cover' | 'gaps'>('resume');
  return (
    <div className="g-card g-pop">
      <div className="seg g-seg g-seg3" role="tablist" aria-label="Draft sections">
        {(
          [
            ['resume', 'Résumé'],
            ['cover', 'Cover letter'],
            ['gaps', 'Gaps Claude found'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="g-sheet">
        {tab === 'resume' && (
          <>
            <h4>Asha Verma</h4>
            <p className="g-row">
              <b>ML engineer</b>, Fernleaf AI <span className="g-date">Jul 2023 – Present</span>
            </p>
            <ul>
              <li>Trained a ranking model in <b>PyTorch</b> and tracked every run in <b>MLflow</b>.</li>
              <li>Cut batch inference time by <b>40%</b> by moving feature code from Pandas to SQL.</li>
              <li>Packaged the service in <b>Docker</b> for the platform team.</li>
            </ul>
            <p className="g-hint">Keywords and numbers are bold. Dates sit flush right, as on your own résumé.</p>
          </>
        )}
        {tab === 'cover' && (
          <>
            <p>Dear Fernleaf hiring team,</p>
            <p>I am a machine learning engineer with about three years of experience building ranking models in PyTorch. Your posting asks for someone who can take a model from notebook to service; at my current role I did exactly that, and cut batch inference time by 40%.</p>
            <p>I would like to talk about how that experience fits your search team.</p>
            <p>Asha Verma</p>
            <p className="g-hint">Written only from your profile. It does not claim Kubernetes experience.</p>
          </>
        )}
        {tab === 'gaps' && (
          <>
            <p className="g-lbl flag">Requirements your profile does not cover</p>
            <ul>
              <li>Kubernetes in production</li>
              <li>Experience working in a team of 5 or more engineers</li>
            </ul>
            <p className="g-hint">These were left out of the draft on purpose. Decide how to speak to them, or whether to apply.</p>
          </>
        )}
      </div>
    </div>
  );
}

type Col = 'draft' | 'sent' | 'interview';
const COLS: { id: Col; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'interview', label: 'Interview' },
];
function BoardPanel() {
  const [cards, setCards] = useState<{ id: string; name: string; col: Col }[]>([
    { id: 'f', name: 'Fernleaf AI', col: 'draft' },
    { id: 'b', name: 'Brightloom', col: 'draft' },
    { id: 'q', name: 'Quillbyte', col: 'interview' },
  ]);
  const move = (id: string, dir: 1 | -1) =>
    setCards((cs) =>
      cs.map((c) => {
        if (c.id !== id) return c;
        const i = COLS.findIndex((x) => x.id === c.col) + dir;
        return i < 0 || i >= COLS.length ? c : { ...c, col: COLS[i].id };
      }),
    );
  // Claude's step in the story: Fernleaf starts as sent once the demo plays
  useEffect(() => {
    const t = setTimeout(() => setCards((cs) => cs.map((c) => (c.id === 'f' ? { ...c, col: 'sent' } : c))), reducedMotion() ? 0 : 700);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="g-card g-board g-pop">
      {COLS.map((col) => (
        <div key={col.id} className="g-col">
          <p className="g-lbl">{col.label}</p>
          {cards
            .filter((c) => c.col === col.id)
            .map((c) => (
              <div key={c.id} className="g-kcard">
                <b>{c.name}</b>
                <span className="g-kbtns">
                  <button type="button" className="btn quiet small" aria-label={`Move ${c.name} back`} disabled={col.id === 'draft'} onClick={() => move(c.id, -1)}>
                    ←
                  </button>
                  <button type="button" className="btn quiet small" aria-label={`Move ${c.name} forward`} disabled={col.id === 'interview'} onClick={() => move(c.id, 1)}>
                    →
                  </button>
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function Demo() {
  const [sid, setSid] = useState<Scenario['id']>('resume');
  const sc = SCENARIOS.find((s) => s.id === sid)!;
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  const [toolsShown, setToolsShown] = useState(0);
  const [toolsDone, setToolsDone] = useState(0);
  const [paras, setParas] = useState(0);
  const [run, setRun] = useState(0);
  const token = useRef({ c: false });
  const chat = useRef<HTMLDivElement>(null);

  const stop = useCallback(() => {
    token.current.c = true;
  }, []);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    const el = chat.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [toolsShown, toolsDone, paras, phase]);

  function pick(id: Scenario['id']) {
    stop();
    setSid(id);
    setPhase('ready');
    setToolsShown(0);
    setToolsDone(0);
    setParas(0);
  }

  async function play() {
    stop();
    const tok = { c: false };
    token.current = tok;
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) =>
        setTimeout(() => (tok.c ? reject(new Error('stopped')) : resolve()), reducedMotion() ? 0 : ms),
      );
    setPhase('running');
    setToolsShown(0);
    setToolsDone(0);
    setParas(0);
    setRun((r) => r + 1);
    try {
      await sleep(500);
      for (let i = 0; i < sc.tools.length; i++) {
        setToolsShown(i + 1);
        await sleep(900);
        setToolsDone(i + 1);
        await sleep(200);
      }
      for (let i = 0; i < sc.reply.length; i++) {
        setParas(i + 1);
        await sleep(800);
      }
      setPhase('done');
    } catch {
      /* switched scenario or left the page */
    }
  }

  const started = phase !== 'ready';
  return (
    <section id="try" className="g-sec">
      <header className="g-sec-head">
        <h2>Try it before you set anything up</h2>
      </header>
      <p className="g-lede">
        Pick a task, press <b>Send</b>, and watch what Claude does and what appears in Jobhunt. This is a simulation with made-up people and companies, so nothing here touches your account.
      </p>
      <div className="g-chiprow" role="tablist" aria-label="Examples">
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" role="tab" className="chip" aria-selected={sid === s.id} aria-pressed={sid === s.id} onClick={() => pick(s.id)}>
            {s.tab}
          </button>
        ))}
      </div>

      <div className="g-demo">
        <div className="g-chat" aria-label="Simulated chat with Claude">
          <div className="g-chat-log" ref={chat} aria-live="polite">
            {!started && <p className="g-empty">Press Send to start.</p>}
            {started && (
              <div className="g-msg me">
                {sc.attach && (
                  <span className="g-attach">
                    <svg className="ic" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" /></svg>
                    {sc.attach}
                  </span>
                )}
                {sc.prompt}
              </div>
            )}
            {started && toolsShown > 0 && (
              <ul className="g-tools" aria-label="Jobhunt tools Claude used">
                {sc.tools.slice(0, toolsShown).map((t, i) => (
                  <li key={t.name} className={toolsDone > i ? 'ok' : 'busy'}>
                    <span className="g-dot" aria-hidden />
                    <span>
                      {t.title} <code>{t.name}</code>
                    </span>
                    <small>{toolsDone > i ? 'done' : 'working'}</small>
                  </li>
                ))}
              </ul>
            )}
            {started && paras > 0 && (
              <div className="g-msg claude">
                {sc.reply.slice(0, paras).map((p, i) => (
                  <p key={i} className="g-pop">
                    {p}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="g-compose">
            {sc.attach && (
              <span className="g-attach in">
                <svg className="ic" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" /></svg>
                {sc.attach}
              </span>
            )}
            <p className="g-compose-text">{sc.prompt}</p>
            <div className="g-compose-actions">
              <CopyButton text={(sc.attach ? 'Attach your résumé, then send: ' : '') + sc.prompt} label="Copy prompt" small />
              <button type="button" className="btn primary small" onClick={play} disabled={phase === 'running'}>
                {phase === 'ready' ? 'Send' : phase === 'running' ? 'Claude is working…' : 'Play again'}
              </button>
            </div>
          </div>
        </div>

        <div className="g-side">
          <p className="g-side-title">
            {sc.panelTitle} <span className="g-eg">Example</span>
          </p>
          {!started || (toolsDone < sc.tools.length && phase === 'running') ? (
            <div className="g-card g-placeholder">
              <p>{phase === 'running' ? 'Waiting for Claude…' : 'What Claude saves will show up here.'}</p>
            </div>
          ) : (
            <div key={`${sid}-${run}`}>
              {sid === 'resume' && <ProfilePanel />}
              {sid === 'search' && <JobsPanel scored={false} />}
              {sid === 'score' && <JobsPanel scored />}
              {sid === 'draft' && <DraftPanel />}
              {sid === 'track' && <BoardPanel />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── prompts ───────────────────────── */

const PROMPTS: { cat: string; title: string; text: string }[] = [
  { cat: 'Profile', title: 'Fill in my profile from a résumé', text: "Using Jobhunt, read the résumé I attached and fill in my profile. Copy facts exactly, don't add anything that isn't in it, then tell me what looks thin or missing." },
  { cat: 'Profile', title: 'Add a new role', text: 'Add this to my Jobhunt profile as my current role, keeping everything else: <paste your title, company, dates and what you did>.' },
  { cat: 'Profile', title: 'Review my profile', text: 'Read my Jobhunt profile and tell me what a recruiter would find thin or unclear. Do not change anything.' },
  { cat: 'Search', title: 'A first search', text: 'Using Jobhunt, find machine learning engineer jobs in Bengaluru posted this week and score them against my profile.' },
  { cat: 'Search', title: 'Several roles, remote only', text: 'Search Jobhunt for data scientist and applied scientist roles, remote only, posted in the last 3 days.' },
  { cat: 'Search', title: 'Check before spending credit', text: 'List the searches I have already run in Jobhunt. Is there anything from this week I can reuse before running a new one?' },
  { cat: 'Score', title: 'Score one search', text: 'Score the jobs from my AI Research Engineer search and show the best five with reasons and red flags.' },
  { cat: 'Score', title: 'Score everything new', text: 'Score every job in Jobhunt that does not have a fit score yet. Be strict: 80 or more only for a real match.' },
  { cat: 'Score', title: 'Clear out the weak ones', text: 'Dismiss every job below 50 in Jobhunt. Nothing is deleted, so tell me how many you dismissed.' },
  { cat: 'Apply', title: 'Draft an application', text: 'Draft an application for the second one. Flag every requirement my profile does not cover.' },
  { cat: 'Apply', title: 'Add a posting by hand', text: 'Here is a job posting I found myself. Add it to Jobhunt and draft an application: <paste the full posting text>.' },
  { cat: 'Apply', title: 'Fact-check before saving', text: 'Check this cover letter against my Jobhunt profile and the posting before you save it. Tell me anything that is not in my profile.' },
  { cat: 'Track', title: 'Update a status', text: 'Mark my Fernleaf application as sent.' },
  { cat: 'Track', title: 'What is open?', text: 'List my Jobhunt applications that are still in draft or at interview stage.' },
];
const CATS = ['All', 'Profile', 'Search', 'Score', 'Apply', 'Track'];

function Prompts() {
  const [cat, setCat] = useState('All');
  const list = PROMPTS.filter((p) => cat === 'All' || p.cat === cat);
  return (
    <section id="prompts" className="g-sec">
      <header className="g-sec-head">
        <h2>What to say to Claude</h2>
      </header>
      <p className="g-lede">Plain words work. Copy one, change the details in &lt;angle brackets&gt; or the role and city, and send it in a chat where Jobhunt is connected.</p>
      <div className="g-chiprow">
        {CATS.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <ul className="g-prompts">
        {list.map((p) => (
          <li key={p.title} className="g-pcard">
            <p className="g-ptitle">
              {p.title} <small>{p.cat}</small>
            </p>
            <PromptBox text={p.text} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────────────────────── tour of the app ───────────────────────── */

const TOUR = [
  {
    id: 'jobs',
    label: 'Jobs',
    href: '/',
    intro: 'Every listing your searches found, sorted by how well it fits you.',
    points: ['The list on the left shows your past searches. Pick one to see only its listings, or pick All jobs.', 'Filter by role, place, level and years of experience. Switch between New, Saved, Applied and Dismissed.', 'Open a job to read the posting, see Claude’s reasons and red flags, keep private notes, and save or dismiss it.', 'Nothing is ever deleted. Dismissed jobs are only hidden.'],
    tryIt: 'Open a job with a score and read the red flags before you decide.',
  },
  {
    id: 'applications',
    label: 'Applications',
    href: '/applications',
    intro: 'Drafts Claude wrote for you, and where each one stands.',
    points: ['A board with Draft, Sent, Interview, Offer, Rejected and Withdrawn.', 'Open a draft to edit the résumé and cover letter. Keywords and numbers are shown in bold.', 'The “Gaps Claude found” box lists requirements your profile does not cover. Read it before sending anything.', 'Download as Word, or save as PDF from the print view.'],
    tryIt: 'Edit one bullet in a draft, then download the Word file.',
  },
  {
    id: 'profile',
    label: 'Profile',
    href: '/profile',
    intro: 'The only source Claude may draw on when it writes about you.',
    points: ['Basics, skills, experience, projects, education, achievements, publications.', 'Email, phone and links live here. Claude does not see them; Jobhunt adds them to downloads.', 'Edit by hand any time, or ask Claude to change a section.', 'The job titles here are what searches use when you do not name a role.'],
    tryIt: 'Check that your dates and numbers match your résumé exactly.',
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    intro: 'Your account, your Apify token, the Claude connector and the job sources.',
    points: ['Change your password, and add or replace your Apify token.', 'Copy the connector address for Claude.', 'Job sources: LinkedIn and Y Combinator come ready. Use “Test with 3 results” to see raw output cheaply before a big search.', 'If you are the owner, the People section lets you reset someone’s password.'],
    tryIt: 'Press “Test with 3 results” on LinkedIn to see what a search returns.',
  },
];

function Tour() {
  const [id, setId] = useState('jobs');
  const t = TOUR.find((x) => x.id === id)!;
  return (
    <section id="app" className="g-sec">
      <header className="g-sec-head">
        <h2>A tour of the app</h2>
      </header>
      <div className="g-tour">
        <div className="g-tabs" role="tablist" aria-label="App pages" aria-orientation="vertical">
          {TOUR.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={id === x.id} onClick={() => setId(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="g-card g-tour-body" role="tabpanel" key={t.id}>
          <h3>{t.label}</h3>
          <p className="g-lede">{t.intro}</p>
          <ul>
            {t.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="g-callout">
            <b>Try this:</b> {t.tryIt}
          </p>
          <Link href={t.href} className="btn small">
            Open {t.label}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── good to know ───────────────────────── */

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: 'I forgot my password.', a: <>Contact SK. Only the owner can set a new password for you. When it changes you are signed out everywhere, including Claude, so reconnect the connector after you sign in with the new one.</> },
  { q: 'Who can see my jobs, résumé and drafts?', a: <>Only you. Each account is separate, and not even the owner can open another person’s jobs or profile. The owner sees a list of usernames with counts, and can reset or delete an account.</> },
  { q: 'Does Claude make things up in my application?', a: <>It is told to use only facts from your profile, and a fact check compares every draft against your profile and the posting. Anything your profile lacks goes into the gaps box instead of the letter. You should still read every draft before sending it.</> },
  { q: 'What does a search cost?', a: <>It runs on your own Apify account. About 25 listings from one source usually costs a few cents, and each role and place you add multiplies the number of runs. Ask Claude to check past searches before running another, and look at Apify’s pricing page for current numbers.</> },
  { q: 'Claude says it cannot find Jobhunt.', a: <>Check that the connector is on for this chat (the tools menu in Claude). If it still fails, remove the connector, add it again with the address from Setup step 3, and sign in again. After a password change you need to do this once.</> },
  { q: 'A search says I need an Apify token.', a: <>Add yours under Settings → Your Apify account. Searches always run on the account of the person who asks.</> },
  { q: 'A job has only a short description.', a: <>Some sources give little text. Open the posting, copy the full text, use <b>Add a posting</b> in Jobhunt (or ask Claude to add it), and then ask for the draft.</> },
  { q: 'A search found nothing or looked odd.', a: <>Actors change over time. In Settings use <b>Test with 3 results</b> on that source to see the raw output, and adjust the actor input or pick another preset.</> },
  { q: 'Can I get a PDF?', a: <>Yes. Open the draft and choose Download PDF: the server makes the file, so it is the same on every device. Choose the paper (A4 or US Letter) and the length first. The text is sized so the resume comes out as one full page, or two full pages, and you are told how many lines to cut or add when it cannot. Print or save as PDF in the print view does the same through your browser. The Word download is not page-fitted.</> },
];

function Faq() {
  return (
    <section id="help" className="g-sec">
      <header className="g-sec-head">
        <h2>Good to know</h2>
      </header>
      <div className="g-faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <div>{f.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── page ───────────────────────── */

const TOC = [
  ['setup', 'Set up'],
  ['try', 'Try it'],
  ['prompts', 'Prompts'],
  ['app', 'The app'],
  ['help', 'Help'],
];

export function GuideView({ username }: { username: string | null }) {
  return (
    <div className="g-page">
      <header className="g-top noprint">
        <Link href={username ? '/' : '/login'} className="brand">
          Job<span>hunt</span>
        </Link>
        <nav className="g-toc" aria-label="On this page">
          {TOC.map(([id, l]) => (
            <a key={id} href={`#${id}`}>
              {l}
            </a>
          ))}
        </nav>
        <ThemeToggle />
        {username ? (
          <Link href="/" className="btn small">
            Open Jobhunt
          </Link>
        ) : (
          <Link href="/login" className="btn small primary">
            Sign in
          </Link>
        )}
      </header>

      <main className="g-main">
        <section className="g-hero">
          <h1>From résumé to application, with Claude doing the typing.</h1>
          <p>
            Jobhunt finds listings, Claude reads your résumé and scores each job against it, then writes drafts that use only what is true about you. This guide shows each step with examples you can try.
          </p>
          <div className="g-hero-actions">
            <a href="#setup" className="btn primary">
              Start setup
            </a>
            <a href="#try" className="btn">
              Watch an example
            </a>
          </div>
          <ol className="g-flow" aria-label="How it works">
            {['Résumé', 'Profile', 'Search', 'Fit scores', 'Drafts', 'Tracking'].map((s, i) => (
              <li key={s}>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </section>

        <Setup />
        <Demo />
        <Prompts />
        <Tour />
        <Faq />

        <footer className="g-foot">
          <p>
            Need help or a password change? Contact SK.{' '}
            {username ? (
              <Link href="/">Back to Jobhunt</Link>
            ) : (
              <Link href="/login">Sign in or create an account</Link>
            )}
          </p>
        </footer>
      </main>
    </div>
  );
}
