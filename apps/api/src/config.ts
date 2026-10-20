import { readFileSync } from 'node:fs';
import { z } from 'zod';

const commaList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:[/][/]/, 'DATABASE_URL must be a PostgreSQL URL'),
  MONGODB_URL: z.string().regex(/^mongodb(\+srv)?:[/][/]/, 'MONGODB_URL must be a MongoDB URL'),
  MONGODB_DATABASE: z.string().default('codelens'),
  REDIS_URL: z.string().regex(/^rediss?:[/][/]/, 'REDIS_URL must be a Redis URL'),
  /** Fixed by the operator, never read from a payload: GitHub Enterprise Server support. */
  GITHUB_API_URL: z.url({ protocol: /^https$/ }).default('https://api.github.com'),
  GITHUB_WEB_URL: z.url({ protocol: /^https$/ }).default('https://github.com'),
});

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

const base64Key = z
  .string()
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((key) => key.length === 32, 'Must be 32 bytes, base64-encoded');

export const ApiConfigSchema = baseSchema.extend({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** Number of reverse proxies in front of the API, used to find the client IP. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Several secrets may be active at once, so that the webhook secret rotates without downtime. */
  GITHUB_WEBHOOK_SECRETS: commaList.pipe(
    z.array(z.string().min(20, 'Each webhook secret needs at least 20 characters')).min(1),
  ),

  /** Origin of the dashboard: OAuth redirect URI and Origin check of state-changing requests. */
  PUBLIC_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3001'),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  /** Encrypts the GitHub user tokens kept in sessions. */
  SESSION_SECRET: base64Key,
  SESSION_HOURS: z.coerce.number().int().min(1).max(12).default(8),
  COOKIE_SECURE: booleanFlag.default(true),
});

export const WorkerConfigSchema = baseSchema.extend({
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  /** PEM private key of the GitHub App, inline (\n escaped) or through GITHUB_PRIVATE_KEY_FILE. */
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_PRIVATE_KEY_FILE: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type WorkerConfig = Omit<
  z.infer<typeof WorkerConfigSchema>,
  'GITHUB_PRIVATE_KEY' | 'GITHUB_PRIVATE_KEY_FILE'
> & { GITHUB_PRIVATE_KEY: string };

function parse<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return parse(ApiConfigSchema, env);
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): WorkerConfig {
  const { GITHUB_PRIVATE_KEY, GITHUB_PRIVATE_KEY_FILE, ...config } = parse(WorkerConfigSchema, env);
  const privateKey = GITHUB_PRIVATE_KEY_FILE
    ? readFile(GITHUB_PRIVATE_KEY_FILE)
    : GITHUB_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey?.includes('PRIVATE KEY-----')) {
    throw new Error(
      'Invalid environment configuration: set GITHUB_PRIVATE_KEY_FILE or GITHUB_PRIVATE_KEY to the PEM key of the GitHub App',
    );
  }
  return { ...config, GITHUB_PRIVATE_KEY: privateKey };
}
