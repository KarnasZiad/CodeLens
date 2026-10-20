import { z } from 'zod';

// Only the fields CodeLens uses. Unknown fields are stripped, so GitHub can add fields freely.
const id = z.number().int().positive();
const account = z.object({ login: z.string().min(1).max(100), type: z.string().min(1).max(50) });
const fullName = z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/);
const repository = z.object({ id, full_name: fullName, private: z.boolean() });

export const installationEvent = z.object({
  action: z.string(),
  installation: z.object({ id, account }),
  repositories: z.array(repository).optional(),
});

export const installationRepositoriesEvent = z.object({
  action: z.enum(['added', 'removed']),
  installation: z.object({ id, account }),
  repositories_added: z.array(repository).default([]),
  repositories_removed: z.array(z.object({ id })).default([]),
});

export const pullRequestEvent = z.object({
  action: z.string(),
  installation: z.object({ id }),
  repository: repository.extend({
    default_branch: z.string().max(255).optional(),
    owner: account,
  }),
  pull_request: z.object({
    id,
    number: id,
    title: z.string().max(1024),
    user: z.object({ login: z.string().min(1).max(100) }),
    state: z.enum(['open', 'closed']),
    merged: z.boolean().nullish(),
    draft: z.boolean().default(false),
    head: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/), ref: z.string().max(255) }),
    base: z.object({ ref: z.string().max(255) }),
  }),
});

export type InstallationEvent = z.infer<typeof installationEvent>;
export type PullRequestEvent = z.infer<typeof pullRequestEvent>;

/** Pull request actions that change the code to review. */
export const REVIEWED_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review']);
