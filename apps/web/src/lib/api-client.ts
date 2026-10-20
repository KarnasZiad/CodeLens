export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: 401 | 404 } | { ok: false; status: 'unavailable' };

export interface ApiRequest {
  baseUrl: string;
  path: string;
  /** Cookie header of the incoming request, forwarded so the API sees the user's session. */
  cookie: string;
  fetcher?: typeof fetch;
}

/**
 * Server-side call to the CodeLens API. 401 and 404 are expected outcomes the pages turn into a
 * redirect or a not-found page; anything else means the API is unavailable.
 */
export async function requestApi<T>({
  baseUrl,
  path,
  cookie,
  fetcher = fetch,
}: ApiRequest): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetcher(new URL(path, baseUrl), {
      headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, status: 'unavailable' };
  }
  if (response.status === 401 || response.status === 404)
    return { ok: false, status: response.status };
  if (!response.ok) return { ok: false, status: 'unavailable' };
  return { ok: true, data: (await response.json()) as T };
}
