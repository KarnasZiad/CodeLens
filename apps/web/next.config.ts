import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * The browser only talks to the dashboard origin: /api is relayed to the CodeLens API, so the
 * session cookie stays first-party and the browser never needs CORS. Rewrites are resolved at
 * build time: API_URL is a build argument of the Docker image.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const config: NextConfig = {
  output: 'standalone',
  // The monorepo root, so that the standalone output traces workspace dependencies.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: [new URL('https://avatars.githubusercontent.com/u/**')],
  },
  rewrites() {
    return Promise.resolve([{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }]);
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ]);
  },
};

export default config;
