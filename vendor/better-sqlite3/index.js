const { spawnSync } = require('node:child_process');

class Database {
  constructor(filename) { this.filename = filename; }
  pragma(sql) { this.exec(`PRAGMA ${sql};`); }
  exec(sql) { return runPython(this.filename, 'exec', sql); }
  prepare(sql) { return new Statement(this.filename, sql); }
}

class Statement {
  constructor(filename, sql) {
    this.filename = filename;
    this.sql = sql;
    this.reader = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
  }
  all() { return runPython(this.filename, 'all', this.sql).rows || []; }
  run() {
    const result = runPython(this.filename, 'run', this.sql);
    return { changes: result.changes || 0, lastInsertRowid: result.lastInsertRowid || 0 };
  }
}

function runPython(filename, mode, sql) {
  const script = `
import json, sqlite3, sys
payload = json.loads(sys.stdin.read())
conn = sqlite3.connect(payload['filename'])
conn.row_factory = sqlite3.Row
conn.execute('PRAGMA foreign_keys = ON')
try:
    if payload['mode'] == 'exec':
        conn.executescript(payload['sql'])
        conn.commit()
        print(json.dumps({'ok': True}))
    elif payload['mode'] == 'all':
        cur = conn.execute(payload['sql'])
        rows = [dict(r) for r in cur.fetchall()]
        conn.commit()
        print(json.dumps({'ok': True, 'rows': rows}))
    else:
        cur = conn.execute(payload['sql'])
        conn.commit()
        print(json.dumps({'ok': True, 'changes': cur.rowcount if cur.rowcount != -1 else 0, 'lastInsertRowid': cur.lastrowid or 0}))
except Exception as exc:
    print(json.dumps({'ok': False, 'error': str(exc)}))
    sys.exit(2)
finally:
    conn.close()
`;
  const proc = spawnSync('python3', ['-c', script], { input: JSON.stringify({ filename, mode, sql }), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (proc.status !== 0) {
    const parsed = tryJson(proc.stdout);
    throw new Error(parsed?.error || proc.stderr || 'SQLite bridge failed');
  }
  const parsed = tryJson(proc.stdout);
  if (!parsed?.ok) throw new Error(parsed?.error || 'SQLite bridge failed');
  return parsed;
}

function tryJson(value) { try { return JSON.parse(value); } catch { return null; } }
module.exports = Database;
