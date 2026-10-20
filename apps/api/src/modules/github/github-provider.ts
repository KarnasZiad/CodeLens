import { type ChangedFile, type FileStatus, SUMMARY_MARKER } from '@codelens/review-engine';
import { createAppAuth } from '@octokit/auth-app';
import { RequestError } from '@octokit/request-error';
import { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';
import { inBatches } from './annotations.js';
import type { CheckResult, GitProvider, PullRequestRef, RepositoryRef } from './git-provider.js';
import { classifyGitHubError } from './github-errors.js';

export const CHECK_NAME = 'CodeLens';
/** GitHub rejects check run summaries above 65,535 characters. */
const MAX_SUMMARY = 65_000;
const MAX_CLIENTS = 500;

export interface GitHubProviderOptions {
  appId: number;
  privateKey: string;
  apiUrl: string;
  webUrl: string;
  logger: Logger;
  /** Injected by tests; the global fetch otherwise. */
  fetch?: typeof fetch;
}

const STATUSES = new Set<FileStatus>([
  'added',
  'modified',
  'removed',
  'renamed',
  'copied',
  'changed',
  'unchanged',
]);

interface GitHubFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

function toChangedFile(file: GitHubFile): ChangedFile {
  return {
    path: file.filename,
    ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
    status: STATUSES.has(file.status as FileStatus) ? (file.status as FileStatus) : 'modified',
    additions: file.additions,
    deletions: file.deletions,
    ...(file.patch === undefined ? {} : { patch: file.patch }),
  };
}

/**
 * GitHub App adapter. Each installation gets its own client: @octokit/auth-app signs a JWT with the
 * app key, exchanges it for an installation token (one hour) and caches that token in memory.
 */
export class GitHubProvider implements GitProvider {
  private readonly clients = new Map<number, Octokit>();

  constructor(private readonly options: GitHubProviderOptions) {}

  private client(installationId: number): Octokit {
    const cached = this.clients.get(installationId);
    if (cached) return cached;
    const { appId, privateKey, apiUrl, logger } = this.options;
    const client = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId },
      baseUrl: apiUrl,
      userAgent: 'codelens',
      request: this.options.fetch ? { fetch: this.options.fetch } : {},
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: (message: string) => {
          logger.warn({ installationId }, message);
        },
        error: (message: string) => {
          logger.error({ installationId }, message);
        },
      },
    });
    if (this.clients.size >= MAX_CLIENTS) {
      const oldest = this.clients.keys().next().value;
      if (oldest !== undefined) this.clients.delete(oldest);
    }
    this.clients.set(installationId, client);
    return client;
  }

  private async call<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      throw classifyGitHubError(error);
    }
  }

  async listFiles(ref: PullRequestRef, limit: number) {
    const octokit = this.client(ref.installationId);
    const files: ChangedFile[] = [];
    // One file more than the limit tells whether the list was cut.
    await this.call(() =>
      octokit.paginate(
        octokit.rest.pulls.listFiles,
        { owner: ref.owner, repo: ref.repo, pull_number: ref.number, per_page: 100 },
        (response, done) => {
          for (const file of response.data) {
            files.push(toChangedFile(file));
            if (files.length > limit) {
              done();
              break;
            }
          }
          return [];
        },
      ),
    );
    return { files: files.slice(0, limit), truncated: files.length > limit };
  }

  async readFile(ref: RepositoryRef, path: string, gitRef: string, maxBytes: number) {
    const octokit = this.client(ref.installationId);
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: ref.owner,
        repo: ref.repo,
        path,
        ref: gitRef,
      });
      if (Array.isArray(data) || data.type !== 'file' || data.size > maxBytes) return null;
      if (!('content' in data) || data.encoding !== 'base64') return null;
      const bytes = Buffer.from(data.content, 'base64');
      // A NUL byte means a binary file: nothing for the analyzers.
      return bytes.includes(0) ? null : bytes.toString('utf8');
    } catch (error) {
      if (error instanceof RequestError && error.status === 404) return null;
      throw classifyGitHubError(error);
    }
  }

  async startCheck(ref: PullRequestRef, externalId: string) {
    const octokit = this.client(ref.installationId);
    const { data } = await this.call(() =>
      octokit.rest.checks.create({
        owner: ref.owner,
        repo: ref.repo,
        name: CHECK_NAME,
        head_sha: ref.headSha,
        external_id: externalId,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        output: {
          title: 'Analyse en cours',
          summary: 'CodeLens analyse les lignes modifiées de cette pull request.',
        },
      }),
    );
    return data.id;
  }

  async completeCheck(ref: RepositoryRef, checkRunId: number, result: CheckResult) {
    const octokit = this.client(ref.installationId);
    const summary =
      result.summary.length > MAX_SUMMARY
        ? `${result.summary.slice(0, MAX_SUMMARY)}\n\n_Résumé tronqué._`
        : result.summary;
    const batches = inBatches(result.annotations);
    const output = (annotations: CheckResult['annotations'] = []) => ({
      title: result.title,
      summary,
      annotations: [...annotations],
    });

    // GitHub appends the annotations of each update; the last one also closes the check.
    for (const batch of batches.slice(0, -1)) {
      await this.call(() =>
        octokit.rest.checks.update({
          owner: ref.owner,
          repo: ref.repo,
          check_run_id: checkRunId,
          output: output(batch),
        }),
      );
    }
    await this.call(() =>
      octokit.rest.checks.update({
        owner: ref.owner,
        repo: ref.repo,
        check_run_id: checkRunId,
        status: 'completed',
        conclusion: result.conclusion,
        completed_at: new Date().toISOString(),
        output: output(batches.at(-1)),
      }),
    );
  }

  async upsertSummaryComment(ref: PullRequestRef, body: string) {
    const octokit = this.client(ref.installationId);
    const comments = await this.call(() =>
      octokit.paginate(octokit.rest.issues.listComments, {
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.number,
        per_page: 100,
      }),
    );
    // Only a comment posted by this app is updated: anyone can paste the marker in a comment.
    const own = comments.find(
      (comment) =>
        comment.performed_via_github_app?.id === this.options.appId &&
        comment.body?.includes(SUMMARY_MARKER),
    );
    if (own) {
      await this.call(() =>
        octokit.rest.issues.updateComment({
          owner: ref.owner,
          repo: ref.repo,
          comment_id: own.id,
          body,
        }),
      );
    } else {
      await this.call(() =>
        octokit.rest.issues.createComment({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: ref.number,
          body,
        }),
      );
    }
  }

  fileUrl(ref: PullRequestRef, path: string, line?: number): string {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${this.options.webUrl}/${ref.owner}/${ref.repo}/blob/${ref.headSha}/${encoded}${line === undefined ? '' : `#L${line}`}`;
  }
}
