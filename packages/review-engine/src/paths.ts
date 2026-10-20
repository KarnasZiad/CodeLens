import picomatch from 'picomatch';

export type Language = 'typescript' | 'javascript' | 'python' | 'vue' | 'go' | 'java' | 'csharp';

const EXTENSIONS: Record<string, Language> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  py: 'python',
  go: 'go',
  java: 'java',
  cs: 'csharp',
};

export function languageOf(path: string): Language | null {
  if (path.endsWith('.d.ts')) return null;
  const extension = /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase();
  return extension ? (EXTENSIONS[extension] ?? null) : null;
}

/** JavaScript-family files, where the JavaScript rules apply (Vue single-file components included). */
export function isScript(language: Language | null): boolean {
  return language === 'typescript' || language === 'javascript' || language === 'vue';
}

const TEST_FILE = picomatch(
  [
    '**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
    '**/*.int-spec.ts',
    '**/__tests__/**',
    '**/{test,tests,e2e,__mocks__,fixtures}/**',
    '**/test_*.py',
    '**/*_test.{py,go}',
    '**/*Test.java',
    '**/*Tests.cs',
  ],
  { dot: true },
);

export function isTestFile(path: string): boolean {
  return TEST_FILE(path);
}

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'go.sum',
]);

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isLockfile(path: string): boolean {
  return LOCKFILES.has(baseName(path));
}

/** Compiles glob patterns once; an empty list matches nothing. */
export function globMatcher(patterns: readonly string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  return picomatch([...patterns], { dot: true });
}
