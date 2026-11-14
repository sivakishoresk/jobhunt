import type { NextConfig } from 'next';

const config: NextConfig = {
  // PGlite (local-only database) ships WASM; keep it out of the bundle.
  // Chromium for server-side PDF is a binary package and must be loaded from node_modules as is.
  serverExternalPackages: ['@electric-sql/pglite', '@sparticuz/chromium', 'puppeteer-core'],
  // Make sure the Chromium archive travels with the one function that needs it.
  outputFileTracingIncludes: {
    '/api/applications/[id]/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
  poweredByHeader: false,
};

export default config;
