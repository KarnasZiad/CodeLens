import { describe, expect, it } from 'vitest';
import { changedFile, config, findingsOf } from '../../test/helpers.js';

describe('debug-statements analyzer', () => {
  it('flags focused tests as critical, in every test runner syntax', () => {
    const findings = findingsOf('debug-statements', [
      changedFile('src/cart.spec.ts', [
        "describe.only('cart', () => {",
        "  it.only('adds', () => {});",
        "  test.only('removes', () => {});",
        "  fit('jasmine style', () => {});",
        "  it('runs', () => {});",
      ]),
    ]);

    expect(findings.map((finding) => [finding.rule, finding.severity, finding.line])).toEqual([
      ['focused-test', 'critical', 1],
      ['focused-test', 'critical', 2],
      ['focused-test', 'critical', 3],
      ['focused-test', 'critical', 4],
    ]);
  });

  it('flags debugger statements and console output in source files', () => {
    const findings = findingsOf('debug-statements', [
      changedFile('src/cart.ts', [
        '  debugger;',
        "  console.log('total', total);",
        '  console.error(error);',
        '  logger.debug("ok");',
      ]),
    ]);

    expect(findings.map((finding) => [finding.rule, finding.severity, finding.line])).toEqual([
      ['debugger', 'major', 1],
      ['console', 'minor', 2],
    ]);
  });

  it('allows console output in tests, scripts and configured paths', () => {
    const files = [
      changedFile('src/cart.spec.ts', ['console.log(result);']),
      changedFile('scripts/seed.ts', ['console.log("seeded");']),
      changedFile('tools/report.ts', ['console.table(rows);']),
    ];
    expect(findingsOf('debug-statements', files.slice(0, 2))).toEqual([]);

    const allowTools = config({
      analyzers: { 'debug-statements': { enabled: true, allowConsoleIn: ['tools/**'] } },
    });
    expect(findingsOf('debug-statements', files.slice(2), { config: allowTools })).toEqual([]);
  });

  it('ignores commented-out code and identifiers that merely contain the words', () => {
    const findings = findingsOf('debug-statements', [
      changedFile('src/cart.ts', [
        "// console.log('debug');",
        ' * it.only is forbidden',
        'const debuggerEnabled = false;',
        'myconsole.log(value);',
        'item.onlyOnce();',
      ]),
    ]);
    expect(findings).toEqual([]);
  });

  it('flags Python breakpoints, and leaves other languages alone', () => {
    const findings = findingsOf('debug-statements', [
      changedFile('app/views.py', ['    breakpoint()', '    import pdb; pdb.set_trace()']),
      changedFile('README.md', ['Call `debugger;` to pause.', "it.only('x')"]),
    ]);
    expect(findings.map((finding) => [finding.path, finding.rule, finding.line])).toEqual([
      ['app/views.py', 'breakpoint', 1],
      ['app/views.py', 'breakpoint', 2],
    ]);
  });

  it('can be disabled', () => {
    const disabled = config({
      analyzers: { 'debug-statements': { enabled: false, allowConsoleIn: [] } },
    });
    expect(
      findingsOf('debug-statements', [changedFile('src/a.ts', ['debugger;'])], {
        config: disabled,
      }),
    ).toEqual([]);
  });
});
