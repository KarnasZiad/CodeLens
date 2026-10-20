import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { requestApi } from './api-client';
import type { Me } from './types';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export class ApiUnavailableError extends Error {
  constructor() {
    super('The CodeLens API is unavailable');
    this.name = 'ApiUnavailableError';
  }
}

async function call<T>(path: string) {
  return requestApi<T>({ baseUrl: API_URL, path, cookie: (await cookies()).toString() });
}

/** Data a page needs: no session goes back to sign-in, an invisible resource is a 404. */
export async function load<T>(path: string, returnTo: string): Promise<T> {
  const result = await call<T>(path);
  if (result.ok) return result.data;
  if (result.status === 401) redirect(`/?next=${encodeURIComponent(returnTo)}`);
  if (result.status === 404) notFound();
  throw new ApiUnavailableError();
}

/** The signed-in user, or null for a visitor. */
export async function currentUser(): Promise<Me | null> {
  const result = await call<Me>('/api/auth/me');
  if (result.ok) return result.data;
  if (result.status === 401) return null;
  throw new ApiUnavailableError();
}
