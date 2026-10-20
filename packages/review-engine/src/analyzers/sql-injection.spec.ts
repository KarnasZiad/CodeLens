import { describe, expect, it } from 'vitest';
import { changedFile, findingsOf } from '../../test/helpers.js';

describe('sql-injection analyzer', () => {
  it.each([
    ['pg template literal', 'await pool.query(`SELECT * FROM users WHERE id = ${id}`);'],
    ['concatenation', 'await db.query("SELECT * FROM users WHERE email = \'" + email + "\'");'],
    ['knex raw', 'knex.raw(`DELETE FROM sessions WHERE user_id = ${userId}`)'],
    ['Prisma unsafe', 'prisma.$queryRawUnsafe(`UPDATE accounts SET balance = ${amount}`)'],
    ['postgres.js unsafe', 'sql.unsafe(`insert into logs values (${message})`)'],
  ])('flags %s as critical', (_name, line) => {
    const findings = findingsOf('sql-injection', [changedFile('src/repo.ts', ['', line])]);
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'string-built-query', severity: 'critical', line: 2 }),
    ]);
  });

  it('follows a template literal over several added lines', () => {
    const findings = findingsOf('sql-injection', [
      changedFile('src/repo.ts', [
        'const rows = await pool.query(`',
        '  SELECT id, email',
        '  FROM users',
        '  WHERE tenant_id = ${tenantId}',
        '`);',
      ]),
    ]);
    expect(findings).toEqual([expect.objectContaining({ line: 1 })]);
  });

  it('accepts parameterized queries and tagged templates', () => {
    const findings = findingsOf('sql-injection', [
      changedFile('src/repo.ts', [
        "await pool.query('SELECT * FROM users WHERE id = $1', [id]);",
        'await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);',
        'await sql`SELECT * FROM users WHERE id = ${id}`;',
        'await prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`;',
        'logger.execute(`Sending ${count} emails`);',
        'const message = `SELECT is a keyword: ${word}`;',
      ]),
    ]);
    expect(findings).toEqual([]);
  });

  it('flags Python f-strings and string formatting passed to execute', () => {
    const findings = findingsOf('sql-injection', [
      changedFile('app/repo.py', [
        'cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")',
        'cursor.execute("DELETE FROM users WHERE id = %s" % user_id)',
        'cursor.execute("SELECT * FROM users WHERE id = {}".format(user_id))',
        'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))',
      ]),
    ]);
    expect(findings.map((finding) => finding.line)).toEqual([1, 2, 3]);
  });

  it('ignores files in other languages', () => {
    expect(
      findingsOf('sql-injection', [changedFile('docs/sql.md', ['query(`SELECT ${x}`)'])]),
    ).toEqual([]);
  });
});
