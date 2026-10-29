'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Jobs' },
  { href: '/applications', label: 'Applications' },
  { href: '/profile', label: 'Profile' },
  { href: '/settings', label: 'Settings' },
];

export function Nav() {
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
      <button
        className="btn quiet small nav-end"
        onClick={async () => {
          await fetch('/api/logout', { method: 'POST' });
          window.location.href = '/login';
        }}
      >
        Sign out
      </button>
    </header>
  );
}
