import { isNode, LineCounter, parseDocument } from 'yaml';
import { z } from 'zod';

/** Name of the configuration file, read from the base branch of the pull request. */
export const CONFIG_PATH = '.codelens.yml';

const MAX_CONFIG_BYTES = 64 * 1024;

const glob = z.string().min(1).max(200);
const enabled = z.boolean().default(true);
const limit = z.int().min(0).max(10_000);

const toggleOnly = z.object({ enabled }).strict().prefault({});

export const configSchema = z
  .object({
    /** Paths left out of the analysis (generated code, vendored files). */
    ignore: z.array(glob).max(100).default([]),
    analyzers: z
      .object({
        secrets: toggleOnly,
        'debug-statements': z
          .object({
            enabled,
            /** Paths where console output is the expected behavior. */
            allowConsoleIn: z.array(glob).max(50).default(['scripts/**', '**/cli/**', 'bin/**']),
          })
          .strict()
          .prefault({}),
        complexity: z
          .object({ enabled, threshold: z.int().min(2).max(100).default(10) })
          .strict()
          .prefault({}),
        'sql-injection': toggleOnly,
        'pr-size': z
          .object({
            enabled,
            warnAt: z.int().min(1).max(100_000).default(400),
            failAt: z.int().min(1).max(100_000).default(1000),
          })
          .strict()
          .refine((options) => options.failAt > options.warnAt, {
            message: 'failAt doit être supérieur à warnAt',
            path: ['failAt'],
          })
          .prefault({}),
        'missing-tests': z
          .object({ enabled, minChangedLines: z.int().min(1).max(10_000).default(10) })
          .strict()
          .prefault({}),
        'todo-comments': toggleOnly,
        dependencies: toggleOnly,
      })
      .strict()
      .prefault({}),
    gate: z
      .object({
        /** Maximum number of findings per severity; null means unlimited. */
        maxFindings: z
          .object({
            blocker: limit.nullable().default(0),
            critical: limit.nullable().default(0),
            major: limit.nullable().default(null),
            minor: limit.nullable().default(null),
            info: limit.nullable().default(null),
          })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type CodeLensConfig = z.output<typeof configSchema>;
export type AnalyzerId = keyof CodeLensConfig['analyzers'];

export const DEFAULT_CONFIG: CodeLensConfig = configSchema.parse({});

export interface ConfigError {
  /** Dotted path of the faulty key, empty for the document itself. */
  path: string;
  message: string;
  line?: number;
}

export type ConfigResult =
  | { ok: true; config: CodeLensConfig; source: 'default' | 'file' }
  | { ok: false; errors: ConfigError[] };

/**
 * Parses `.codelens.yml`. A missing file (null) yields the defaults; an invalid file yields every
 * error in French, so that the check can explain them instead of silently using defaults.
 */
export function parseConfig(text: string | null): ConfigResult {
  if (text === null) return { ok: true, config: DEFAULT_CONFIG, source: 'default' };
  if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) {
    return {
      ok: false,
      errors: [{ path: '', message: 'Fichier trop volumineux (64 Ko maximum).' }],
    };
  }

  // Aliases are capped: a few nested anchors could otherwise expand into gigabytes.
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      ok: false,
      errors: document.errors.map((error) => ({
        path: '',
        message: `YAML invalide : ${error.code}`,
        line: error.linePos?.[0].line,
      })),
    };
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 50 }) ?? {};
  } catch {
    return { ok: false, errors: [{ path: '', message: 'YAML invalide : trop d’alias.' }] };
  }

  const parsed = configSchema.safeParse(value, { error: z.locales.fr().localeError });
  if (parsed.success) return { ok: true, config: parsed.data, source: 'file' };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const node: unknown = document.getIn(issue.path, true);
      const offset = isNode(node) ? node.range?.[0] : undefined;
      return {
        path: issue.path.map(String).join('.'),
        message: issue.message,
        ...(offset === undefined ? {} : { line: lineCounter.linePos(offset).line }),
      };
    }),
  };
}
