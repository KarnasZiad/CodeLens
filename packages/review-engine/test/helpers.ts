import { type CodeLensConfig, DEFAULT_CONFIG } from '../src/config.js';
import { runReview } from '../src/engine.js';
import type { ChangedFile, Finding } from '../src/model.js';

/** A patch where every line is added, starting at line `start` of the head version. */
export function addedPatch(lines: readonly string[], start = 1): string {
  return [`@@ -0,0 +${start},${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n');
}

export function changedFile(
  path: string,
  lines: readonly string[],
  overrides: Partial<ChangedFile> = {},
): ChangedFile {
  return {
    path,
    status: 'modified',
    additions: lines.length,
    deletions: 0,
    patch: addedPatch(lines),
    ...overrides,
  };
}

export const PULL_REQUEST = {
  title: 'Add feature',
  author: 'amina',
  baseRef: 'main',
  headRef: 'feat/x',
};

type ConfigPatch = { [K in keyof CodeLensConfig]?: Partial<CodeLensConfig[K]> };

export function config(patch: ConfigPatch = {}): CodeLensConfig {
  return {
    ...DEFAULT_CONFIG,
    ...patch,
    analyzers: { ...DEFAULT_CONFIG.analyzers, ...patch.analyzers },
    gate: { ...DEFAULT_CONFIG.gate, ...patch.gate },
  } as CodeLensConfig;
}

/** Runs the whole engine and returns the findings of one analyzer. */
export function findingsOf(
  analyzer: string,
  files: readonly ChangedFile[],
  options: { config?: CodeLensConfig; contents?: Record<string, string> } = {},
): Finding[] {
  const result = runReview(
    {
      pullRequest: PULL_REQUEST,
      files,
      contents: new Map(Object.entries(options.contents ?? {})),
    },
    options.config ?? DEFAULT_CONFIG,
  );
  return result.findings.filter((finding) => finding.analyzer === analyzer);
}

/**
 * Credentials assembled at runtime: written whole, they would trip secret scanners (GitHub push
 * protection, Trivy) on this repository. None of them is a real credential.
 */
export const FAKE = {
  awsKeyId: ['AKIA', 'Z7Q3', 'MXKD', 'R2PA', 'L9VN'].join(''),
  githubToken: ['ghp', '_', 'a1B2c3D4e5F6'.repeat(3)].join(''),
  slackToken: ['xoxb', '-', '2048', '-', 'k3Jd9LqPzX0'].join(''),
  stripeKey: ['sk', '_live_', 'Q8wErT5yUi1oP3aSd7fGh2jK'].join(''),
  googleKey: ['AIza', 'SyB-1x2Y3z4W5v6U7t8S9r0QpOnMlKjIhGf'].join(''),
  privateKeyHeader: ['-----BEGIN ', 'RSA PRIVATE', ' KEY-----'].join(''),
  password: ['Zx9', '#Lq2', '!vT7', 'mP4w'].join(''),
};
