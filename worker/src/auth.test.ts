import { describe, it, expect } from 'vitest';
import { allowedOrigins } from './auth';

const env = { ALLOWED_ORIGINS: 'https://mathiq.io, https://www.mathiq.io,' };
const deployed = new URL('https://mathiq-api.example.workers.dev/api/walkthrough');
const local = new URL('http://localhost:8787/api/walkthrough');

describe('allowedOrigins', () => {
  it('serves the configured list, trimmed, from a deployed worker', () => {
    expect(allowedOrigins(env, deployed)).toEqual(['https://mathiq.io', 'https://www.mathiq.io']);
  });

  it('adds the Vite dev servers only while the worker itself is on localhost', () => {
    const origins = allowedOrigins(env, local);
    expect(origins.slice(0, 2)).toEqual(['https://mathiq.io', 'https://www.mathiq.io']);
    expect(origins).toContain('http://localhost:5173');
    expect(allowedOrigins(env, new URL('http://127.0.0.1:8787/'))).toContain('http://localhost:5173');
  });

  it('never adds them for a deployed worker, whatever the config says', () => {
    const permissive = { ALLOWED_ORIGINS: 'https://mathiq.io,http://localhost:5173' };
    // The config can still list it; that's the operator's call. What the
    // worker must never do is add it on its own.
    expect(allowedOrigins(env, deployed)).not.toContain('http://localhost:5173');
    expect(allowedOrigins(permissive, deployed)).toEqual(['https://mathiq.io', 'http://localhost:5173']);
  });
});
