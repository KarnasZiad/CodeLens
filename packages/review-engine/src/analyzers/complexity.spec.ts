import { describe, expect, it } from 'vitest';
import { changedFile, config, findingsOf } from '../../test/helpers.js';
import { functionComplexities } from './complexity.js';

const SOURCE = `export function price(order: Order): number {
  let total = 0;
  for (const line of order.lines) {
    if (line.free) continue;
    total += line.price * (line.quantity ?? 1);
  }
  return order.coupon && total > 100 ? total * 0.9 : total;
}

export const describeStatus = (status: Status) => {
  switch (status) {
    case 'draft':
      return 'Brouillon';
    case 'sent':
      return 'Envoyée';
    default:
      return 'Inconnue';
  }
};

class Cart {
  constructor(private readonly items: Item[]) {}

  get empty() {
    return this.items.length === 0;
  }

  load() {
    try {
      return JSON.parse(storage.read() || '[]');
    } catch {
      return [];
    }
  }
}

export const handlers = {
  onSubmit: function () {
    return [1, 2].map((value) => (value > 1 ? value : 0));
  },
};
`;

describe('functionComplexities', () => {
  it('counts decision points per function, nested functions apart', () => {
    const byName = Object.fromEntries(
      functionComplexities('src/order.ts', SOURCE).map((fn) => [fn.name, fn.complexity]),
    );

    // for + if + ?? + && + ?: = 5 decision points.
    expect(byName.price).toBe(6);
    // Two cases; the default clause adds no branch.
    expect(byName.describeStatus).toBe(3);
    expect(byName.constructor).toBe(1);
    expect(byName.empty).toBe(1);
    // catch + ||.
    expect(byName.load).toBe(3);
    // The arrow function inside map is measured on its own.
    expect(byName.onSubmit).toBe(1);
    expect(byName['<anonyme>']).toBe(2);
  });

  it('reports the line span of each function', () => {
    const price = functionComplexities('src/order.ts', SOURCE).find((fn) => fn.name === 'price');
    expect(price).toMatchObject({ startLine: 1, endLine: 8 });
  });

  it('parses JSX and plain JavaScript, and ignores other files', () => {
    const jsx =
      'export function List({ items }) { return items.length ? <ul>{items.map((i) => <li>{i}</li>)}</ul> : null; }';
    expect(functionComplexities('src/List.jsx', jsx)[0]?.complexity).toBe(2);
    expect(functionComplexities('src/List.tsx', jsx)[0]?.complexity).toBe(2);
    expect(
      functionComplexities('src/a.cjs', 'module.exports = function f(a) { return a || 1; };')[0]
        ?.complexity,
    ).toBe(2);
    expect(functionComplexities('README.md', '# title')).toEqual([]);
  });

  it('survives syntax errors without throwing', () => {
    expect(() => functionComplexities('src/broken.ts', 'function (( {')).not.toThrow();
  });
});

describe('complexity analyzer', () => {
  const complex = [
    'export function route(request) {',
    ...Array.from(
      { length: 11 },
      (_, index) => `  if (request.path === '/p${index}') return ${index};`,
    ),
    '  return -1;',
    '}',
    'export function simple() {',
    '  return 1;',
    '}',
  ].join('\n');

  it('flags a changed function above the threshold', () => {
    const file = changedFile('src/router.ts', [], {
      patch: "@@ -5,1 +5,1 @@\n-  old\n+  if (request.path === '/p3') return 3;",
    });

    const findings = findingsOf('complexity', [file], { contents: { 'src/router.ts': complex } });

    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'cyclomatic-complexity',
        severity: 'major',
        line: 1,
        endLine: 14,
        message: expect.stringContaining(
          '« route » a une complexité cyclomatique de 12 (seuil : 10)',
        ),
      }),
    ]);
  });

  it('ignores complex functions that the pull request does not touch', () => {
    const file = changedFile('src/router.ts', [], {
      patch: '@@ -16,1 +16,1 @@\n-  return 0;\n+  return 1;',
    });
    expect(findingsOf('complexity', [file], { contents: { 'src/router.ts': complex } })).toEqual(
      [],
    );
  });

  it('follows the configured threshold', () => {
    const file = changedFile('src/router.ts', [], { patch: '@@ -5,1 +5,1 @@\n-  a\n+  b' });
    const lenient = config({ analyzers: { complexity: { enabled: true, threshold: 12 } } });
    expect(
      findingsOf('complexity', [file], { config: lenient, contents: { 'src/router.ts': complex } }),
    ).toEqual([]);
  });

  it('skips files whose content could not be loaded, and test files', () => {
    const file = changedFile('src/router.ts', ['x']);
    expect(findingsOf('complexity', [file])).toEqual([]);
    const test = changedFile('src/router.spec.ts', ['x']);
    expect(
      findingsOf('complexity', [test], { contents: { 'src/router.spec.ts': complex } }),
    ).toEqual([]);
  });
});
