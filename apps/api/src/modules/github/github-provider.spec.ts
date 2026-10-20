import { generateKeyPairSync } from 'node:crypto';
import { SUMMARY_MARKER } from '@codelens/review-engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../testing/fixtures.js';
import { PermanentProviderError, RateLimitedError } from './git-provider.js';
import { GitHubProvider } from './github-provider.js';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const APP_ID = 123;
const REF = { installationId: 42, owner: 'acme', repo: 'shop', number: 7, headSha: 'a'.repeat(40) };

interface Call {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

type Route = (
  call: Call,
) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** A tiny GitHub API: answers by method and path, and records every call. */
function fakeGitHub(routes: Route[]) {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: headers.get('authorization'),
    };
    calls.push(call);
    if (call.method === 'POST' && call.path === '/app/installations/42/access_tokens') {
      return Promise.resolve(
        Response.json(
          {
            token: 'ghs_installation',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            permissions: {},
          },
          { status: 201 },
        ),
      );
    }
    for (const route of routes) {
      const answer = route(call);
      if (answer) {
        const status = answer.status ?? 200;
        return Promise.resolve(
          new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), {
            status,
            headers: { 'content-type': 'application/json', ...answer.headers },
          }),
        );
      }
    }
    return Promise.resolve(Response.json({ message: 'Not Found' }, { status: 404 }));
  };
  return { calls, fetch };
}

function provider(routes: Route[]) {
  const github = fakeGitHub(routes);
  return {
    ...github,
    provider: new GitHubProvider({
      appId: APP_ID,
      privateKey,
      apiUrl: 'https://api.github.com',
      webUrl: 'https://github.com',
      logger: silentLogger,
      fetch: github.fetch,
    }),
  };
}

const file = (index: number) => ({
  filename: `src/file-${index}.ts`,
  status: 'modified',
  additions: 1,
  deletions: 0,
  patch: '@@ -0,0 +1 @@\n+x',
});

describe('GitHubProvider', () => {
  let routes: Route[];
  beforeEach(() => {
    routes = [];
  });

  it('authenticates as the installation with a short-lived token', async () => {
    routes.push((call) =>
      call.path.startsWith('/repos/acme/shop/pulls/7/files') ? { body: [] } : undefined,
    );
    const { provider: github, calls } = provider(routes);

    await github.listFiles(REF, 10);

    const [exchange, request] = calls;
    expect(exchange?.authorization).toMatch(/^bearer ey/);
    expect(request?.authorization).toBe('token ghs_installation');
  });

  it('pages through the changed files and reports a cut list', async () => {
    routes.push((call) => {
      if (!call.path.startsWith('/repos/acme/shop/pulls/7/files')) return undefined;
      const page = Number(new URLSearchParams(call.path.split('?')[1]).get('page') ?? '1');
      const headers: Record<string, string> = {};
      if (page < 3) {
        headers.link = `<https://api.github.com/repos/acme/shop/pulls/7/files?per_page=100&page=${page + 1}>; rel="next"`;
      }
      return {
        body: Array.from({ length: 100 }, (_, index) => file((page - 1) * 100 + index)),
        headers,
      };
    });
    const { provider: github } = provider(routes);

    const all = await github.listFiles(REF, 300);
    expect(all.files).toHaveLength(300);
    expect(all.truncated).toBe(false);
    expect(all.files[0]).toEqual({
      path: 'src/file-0.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: '@@ -0,0 +1 @@\n+x',
    });

    const cut = await github.listFiles(REF, 150);
    expect(cut.files).toHaveLength(150);
    expect(cut.truncated).toBe(true);
  });

  it('keeps renames and drops unknown statuses to modified', async () => {
    routes.push((call) =>
      call.path.startsWith('/repos/acme/shop/pulls/7/files')
        ? {
            body: [
              {
                filename: 'b.ts',
                previous_filename: 'a.ts',
                status: 'renamed',
                additions: 0,
                deletions: 0,
              },
              { filename: 'c.ts', status: 'weird', additions: 1, deletions: 1 },
            ],
          }
        : undefined,
    );
    const { files } = await provider(routes).provider.listFiles(REF, 10);
    expect(files).toEqual([
      { path: 'b.ts', previousPath: 'a.ts', status: 'renamed', additions: 0, deletions: 0 },
      { path: 'c.ts', status: 'modified', additions: 1, deletions: 1 },
    ]);
  });

  it('reads text files and refuses missing, large, binary files and directories', async () => {
    const encode = (text: string) => Buffer.from(text).toString('base64');
    routes.push((call) => {
      if (!call.path.startsWith('/repos/acme/shop/contents/')) return undefined;
      const path = decodeURIComponent(
        call.path.split('?')[0]?.replace('/repos/acme/shop/contents/', '') ?? '',
      );
      if (path === '.codelens.yml')
        return {
          body: { type: 'file', size: 10, encoding: 'base64', content: encode('gate: {}\n') },
        };
      if (path === 'big.ts')
        return { body: { type: 'file', size: 10_000, encoding: 'base64', content: encode('x') } };
      if (path === 'logo.png')
        return {
          body: {
            type: 'file',
            size: 4,
            encoding: 'base64',
            content: Buffer.from([137, 80, 0, 71]).toString('base64'),
          },
        };
      if (path === 'src') return { body: [{ type: 'file', name: 'a.ts' }] };
      return undefined;
    });
    const { provider: github, calls } = provider(routes);

    expect(await github.readFile(REF, '.codelens.yml', 'main', 1000)).toBe('gate: {}\n');
    expect(calls.at(-1)?.path).toBe('/repos/acme/shop/contents/.codelens.yml?ref=main');
    expect(await github.readFile(REF, 'big.ts', 'main', 1000)).toBeNull();
    expect(await github.readFile(REF, 'logo.png', 'main', 1000)).toBeNull();
    expect(await github.readFile(REF, 'src', 'main', 1000)).toBeNull();
    expect(await github.readFile(REF, 'missing.ts', 'main', 1000)).toBeNull();
  });

  it('creates the check in progress, then appends annotations by batches of 50 and concludes', async () => {
    routes.push((call) =>
      call.method === 'POST' && call.path === '/repos/acme/shop/check-runs'
        ? { status: 201, body: { id: 99 } }
        : undefined,
    );
    routes.push((call) =>
      call.method === 'PATCH' && call.path === '/repos/acme/shop/check-runs/99'
        ? { body: { id: 99 } }
        : undefined,
    );
    const { provider: github, calls } = provider(routes);

    const id = await github.startCheck(REF, 'run-1');
    expect(id).toBe(99);
    expect(calls.at(-1)?.body).toMatchObject({
      name: 'CodeLens',
      head_sha: REF.headSha,
      status: 'in_progress',
      external_id: 'run-1',
    });

    const annotations = Array.from({ length: 120 }, (_, index) => ({
      path: 'a.ts',
      start_line: index + 1,
      end_line: index + 1,
      annotation_level: 'warning' as const,
      title: 't',
      message: 'm',
    }));
    await github.completeCheck(REF, 99, {
      conclusion: 'failure',
      title: 'Gate',
      summary: 's'.repeat(70_000),
      annotations,
    });

    const updates = calls.filter((call) => call.method === 'PATCH');
    expect(updates).toHaveLength(3);
    expect(
      updates.map(
        (call) => (call.body as { output: { annotations: unknown[] } }).output.annotations.length,
      ),
    ).toEqual([50, 50, 20]);
    expect(updates[0]?.body).not.toHaveProperty('conclusion');
    expect(updates[2]?.body).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect((updates[2]?.body as { output: { summary: string } }).output.summary).toMatch(
      /Résumé tronqué/,
    );
  });

  it('concludes a check without annotations in a single request', async () => {
    routes.push((call) => (call.method === 'PATCH' ? { body: {} } : undefined));
    const { provider: github, calls } = provider(routes);
    await github.completeCheck(REF, 99, {
      conclusion: 'success',
      title: 'ok',
      summary: 'ok',
      annotations: [],
    });
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('updates its own summary comment, and ignores the marker pasted by someone else', async () => {
    let comments = [
      { id: 1, body: `${SUMMARY_MARKER} copied by a human`, performed_via_github_app: null },
      { id: 2, body: `${SUMMARY_MARKER} old summary`, performed_via_github_app: { id: APP_ID } },
    ];
    routes.push((call) =>
      call.method === 'GET' && call.path.startsWith('/repos/acme/shop/issues/7/comments')
        ? { body: comments }
        : undefined,
    );
    routes.push((call) =>
      call.method === 'PATCH' && call.path === '/repos/acme/shop/issues/comments/2'
        ? { body: {} }
        : undefined,
    );
    routes.push((call) =>
      call.method === 'POST' && call.path === '/repos/acme/shop/issues/7/comments'
        ? { status: 201, body: {} }
        : undefined,
    );
    const { provider: github, calls } = provider(routes);

    await github.upsertSummaryComment(REF, 'new summary');
    expect(calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: '/repos/acme/shop/issues/comments/2',
      body: { body: 'new summary' },
    });

    comments = comments.slice(0, 1);
    await github.upsertSummaryComment(REF, 'first summary');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { body: 'first summary' } });
  });

  it('turns rate limits and permission errors into queue decisions', async () => {
    routes.push((call) =>
      call.path.startsWith('/repos/acme/shop/pulls/7/files')
        ? {
            status: 403,
            body: { message: 'API rate limit exceeded' },
            headers: {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
            },
          }
        : undefined,
    );
    routes.push((call) =>
      call.path === '/repos/acme/shop/check-runs'
        ? { status: 403, body: { message: 'Resource not accessible by integration' } }
        : undefined,
    );
    const { provider: github } = provider(routes);

    await expect(github.listFiles(REF, 10)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(github.startCheck(REF, 'run-1')).rejects.toBeInstanceOf(PermanentProviderError);
    await expect(github.readFile(REF, 'x', 'main', 10)).resolves.toBeNull();
  });

  it('builds links to the reviewed commit with encoded paths', () => {
    const { provider: github } = provider(routes);
    expect(github.fileUrl(REF, 'src/a file#1.ts', 12)).toBe(
      `https://github.com/acme/shop/blob/${REF.headSha}/src/a%20file%231.ts#L12`,
    );
    expect(github.fileUrl(REF, 'README.md')).toBe(
      `https://github.com/acme/shop/blob/${REF.headSha}/README.md`,
    );
  });
});
