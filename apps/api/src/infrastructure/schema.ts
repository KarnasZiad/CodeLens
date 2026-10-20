import type { Severity } from '@codelens/review-engine';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// GitHub identifiers went past 2^31 long ago; they stay below 2^53, so numbers are exact.
const githubId = (name: string) => bigint(name, { mode: 'number' });
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const reviewStatus = pgEnum('review_status', ['queued', 'running', 'completed', 'failed']);
export const gateStatus = pgEnum('gate_status', ['passed', 'failed']);
export const checkConclusion = pgEnum('check_conclusion', ['success', 'failure', 'neutral']);
// Spelled out: drizzle-kit loads this file without the workspace build. The type below fails to
// compile if the engine adds or renames a severity.
const SEVERITY_VALUES = ['info', 'minor', 'major', 'critical', 'blocker'] as const;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const severitiesMatchEngine: Same<(typeof SEVERITY_VALUES)[number], Severity> = true;
export const severity = pgEnum('severity', SEVERITY_VALUES);

export const installations = pgTable('installations', {
  id: githubId('id').primaryKey(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  ...timestamps,
});

export const repositories = pgTable(
  'repositories',
  {
    id: githubId('id').primaryKey(),
    installationId: githubId('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    private: boolean('private').notNull(),
    defaultBranch: text('default_branch'),
    ...timestamps,
  },
  (table) => [index('repositories_installation_idx').on(table.installationId)],
);

export const pullRequests = pgTable(
  'pull_requests',
  {
    id: githubId('id').primaryKey(),
    repositoryId: githubId('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    authorLogin: text('author_login').notNull(),
    state: text('state').notNull(),
    draft: boolean('draft').notNull().default(false),
    headSha: text('head_sha').notNull(),
    baseRef: text('base_ref').notNull(),
    headRef: text('head_ref').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('pull_requests_repository_number_key').on(table.repositoryId, table.number),
    check('pull_requests_state_check', sql`${table.state} in ('open', 'closed', 'merged')`),
    check('pull_requests_head_sha_check', sql`${table.headSha} ~ '^[0-9a-f]{40}$'`),
  ],
);

export const reviewRuns = pgTable(
  'review_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pullRequestId: githubId('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    headSha: text('head_sha').notNull(),
    status: reviewStatus('status').notNull().default('queued'),
    gateStatus: gateStatus('gate_status'),
    conclusion: checkConclusion('conclusion'),
    /** Findings per severity, before the per-review cap. */
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    findingsCount: integer('findings_count').notNull().default(0),
    partial: boolean('partial').notNull().default(false),
    checkRunId: githubId('check_run_id'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // One review per commit: enqueuing twice the same push is a no-op.
    unique('review_runs_pull_request_sha_key').on(table.pullRequestId, table.headSha),
    check('review_runs_head_sha_check', sql`${table.headSha} ~ '^[0-9a-f]{40}$'`),
    index('review_runs_pull_request_idx').on(table.pullRequestId, table.queuedAt.desc()),
  ],
);

export const findings = pgTable(
  'findings',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid('run_id')
      .notNull()
      .references(() => reviewRuns.id, { onDelete: 'cascade' }),
    analyzer: text('analyzer').notNull(),
    rule: text('rule').notNull(),
    severity: severity('severity').notNull(),
    path: text('path'),
    line: integer('line'),
    endLine: integer('end_line'),
    message: text('message').notNull(),
  },
  (table) => [
    index('findings_run_idx').on(table.runId),
    index('findings_analyzer_idx').on(table.analyzer),
  ],
);
