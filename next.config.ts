import type { NextConfig } from 'next';

const config: NextConfig = {
  // PGlite (local-only database) ships WASM; keep it out of the bundle.
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
};

export default config;
