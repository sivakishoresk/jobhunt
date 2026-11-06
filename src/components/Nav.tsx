'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/', label: 'Jobs' },
  { href: '/applications', label: 'Applications' },
  { href: '/profile', label: 'Profile' },
  { href: '/settings', label: 'Settings' },
];

type Theme = 'light' | 'dark';

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const set = document.documentElement.dataset.theme;
    setTheme(set === 'light' || set === 'dark' ? set : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, []);
  if (!theme) return <span className="theme-btn" aria-hidden />;
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="btn quiet small theme-btn"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('jh.theme', next);
        } catch {}
        setTheme(next);
      }}
    >
      {theme === 'dark' ? (
        <svg className="ic" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg className="ic" viewBox="0 0 24 24" aria-hidden>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}

export function Nav({ username }: { username: string }) {
  const path = usePathname();
  const current = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <header className="nav noprint">
      <Link href="/" className="brand">
        Job<span>hunt</span>
      </Link>
      <nav className="nav-links" aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={current(l.href) ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <span className="whoami" title={`Signed in as ${username}`}>
        {username}
      </span>
      <ThemeToggle />
      <button
        className="btn quiet small"
        onClick={async () => {
          await fetch('/api/logout', { method: 'POST' });
          window.location.href = '/login';
        }}
      >
        <span className="so-text">Sign out</span>
        <svg className="ic so-icon" viewBox="0 0 24 24" aria-label="Sign out">
          <path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" />
        </svg>
      </button>
    </header>
  );
}
