import { describe, expect, it } from 'vitest';
import { globMatcher, isLockfile, isScript, isTestFile, languageOf } from './paths.js';

describe('paths', () => {
  it('detects languages from extensions, declaration files excluded', () => {
    expect(languageOf('src/a.ts')).toBe('typescript');
    expect(languageOf('src/A.TSX')).toBe('typescript');
    expect(languageOf('src/a.mjs')).toBe('javascript');
    expect(languageOf('src/App.vue')).toBe('vue');
    expect(languageOf('app/models.py')).toBe('python');
    expect(languageOf('types/global.d.ts')).toBeNull();
    expect(languageOf('Makefile')).toBeNull();
    expect(isScript('vue')).toBe(true);
    expect(isScript('python')).toBe(false);
  });

  it('recognizes test files across ecosystems', () => {
    for (const path of [
      'src/cart.spec.ts',
      'src/cart.test.jsx',
      'apps/api/test/integration/db.int-spec.ts',
      'src/__tests__/cart.ts',
      'tests/test_cart.py',
      'pkg/cart_test.go',
      'src/CartTest.java',
      'src/CartTests.cs',
    ]) {
      expect(isTestFile(path), path).toBe(true);
    }
    expect(isTestFile('src/contest.ts')).toBe(false);
    expect(isTestFile('src/testing.ts')).toBe(false);
  });

  it('recognizes lockfiles anywhere in the tree', () => {
    expect(isLockfile('pnpm-lock.yaml')).toBe(true);
    expect(isLockfile('apps/web/package-lock.json')).toBe(true);
    expect(isLockfile('package.json')).toBe(false);
  });

  it('matches globs, dotfiles included', () => {
    const matcher = globMatcher(['dist/**', '**/*.generated.ts']);
    expect(matcher('dist/index.js')).toBe(true);
    expect(matcher('src/.hidden/api.generated.ts')).toBe(true);
    expect(matcher('src/index.ts')).toBe(false);
    expect(globMatcher([])('anything')).toBe(false);
  });
});
