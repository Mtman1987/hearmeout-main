import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import initSqlJs from 'sql.js';

async function seedAndCorrupt(databaseFile: string) {
  process.env.DB_FILE = databaseFile;
  const { db, ensureDb, flushDb } = await import('../src/lib/db');
  await ensureDb();
  db.set('drill', 'record', { generation: 1 });
  flushDb();
  db.set('drill', 'record', { generation: 2 });
  flushDb();
  writeFileSync(databaseFile, 'simulated partial database write');
}

async function recover(databaseFile: string) {
  process.env.DB_FILE = databaseFile;
  const { db, ensureDb } = await import('../src/lib/db');
  await ensureDb();
  const recovered = db.get('drill', 'record');
  if (recovered?.generation !== 1) {
    throw new Error(`Expected backup generation 1, received ${JSON.stringify(recovered)}`);
  }

  const SQL = await initSqlJs();
  const restored = new SQL.Database(readFileSync(databaseFile));
  const result = restored.prepare('PRAGMA integrity_check;');
  try {
    if (!result.step() || Object.values(result.getAsObject())[0] !== 'ok') {
      throw new Error('Restored primary database failed integrity_check');
    }
  } finally {
    result.free();
  }
}

function runChild(mode: string, databaseFile: string) {
  const result = spawnSync(process.execPath, [...process.execArgv, __filename, mode, databaseFile], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${mode} process failed:\n${result.stderr || result.stdout}`);
  }
}

async function main() {
  const [mode, databaseFile] = process.argv.slice(2);
  if (mode === 'seed') return seedAndCorrupt(databaseFile);
  if (mode === 'recover') return recover(databaseFile);

  const drillDirectory = mkdtempSync(join(tmpdir(), 'hmo-db-drill-'));
  const drillDatabase = join(drillDirectory, 'app.db');
  const startedAt = Date.now();
  try {
    runChild('seed', drillDatabase);
    const failureAt = Date.now();
    runChild('recover', drillDatabase);
    process.stdout.write(`${JSON.stringify({
      restored: true,
      rpoGenerations: 1,
      rtoMs: Date.now() - failureAt,
      totalDrillMs: Date.now() - startedAt,
    })}\n`);
  } finally {
    rmSync(drillDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
