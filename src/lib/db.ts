// Shared SQLite database — same /data/app.db as DSH
// Uses sql.js (pure JS/WASM) so it works on any platform without C++ toolchain
// API is compatible with the rest of the app

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

const DB_FILE = process.env.DB_FILE || './data/app.db';

const dbDir = dirname(DB_FILE);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// sql.js requires async init, so we lazy-load and cache the instance
let _db: SqlJsDatabase | null = null;
let _initPromise: Promise<SqlJsDatabase> | null = null;

function getDbSync(): SqlJsDatabase {
  if (_db) return _db;
  throw new Error('Database not initialized. Call ensureDb() first or use the auto-init path.');
}

async function ensureDb(): Promise<SqlJsDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const SQL = await initSqlJs();

    if (existsSync(DB_FILE)) {
      const fileBuffer = readFileSync(DB_FILE);
      _db = new SQL.Database(fileBuffer);
    } else {
      _db = new SQL.Database();
    }

    // Create table if not exists
    _db.run(`
      CREATE TABLE IF NOT EXISTS docs (
        path TEXT PRIMARY KEY,
        collection_path TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    _db.run(`CREATE INDEX IF NOT EXISTS idx_collection ON docs(collection_path);`);

    return _db;
  })();

  return _initPromise;
}

// Auto-init
ensureDb().catch(err => console.error('[DB] Init failed:', err));

function save() {
  if (!_db) return;
  const data = _db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_FILE, buffer);
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => save(), 500);
}

function getNestedField(obj: any, field: string): any {
  return field.split('.').reduce((o, k) => o?.[k], obj);
}

function matchFilter(fieldValue: any, op: string, value: any): boolean {
  switch (op) {
    case '==': return fieldValue === value;
    case '!=': return fieldValue !== value;
    case '>': return fieldValue > value;
    case '>=': return fieldValue >= value;
    case '<': return fieldValue < value;
    case '<=': return fieldValue <= value;
    case 'array-contains': return Array.isArray(fieldValue) && fieldValue.includes(value);
    case 'in': return Array.isArray(value) && value.includes(fieldValue);
    default: return false;
  }
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && !(source[key] instanceof Date)) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

async function getDb(): Promise<SqlJsDatabase> {
  if (_db) return _db;
  return ensureDb();
}

export const db = {
  get(collection: string, docId: string): any {
    if (!_db) return null;
    const path = `${collection}/${docId}`;
    const stmt = _db.prepare('SELECT data FROM docs WHERE path = ?');
    stmt.bind([path]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return JSON.parse(row.data as string);
    }
    stmt.free();
    return null;
  },

  async getAsync(collection: string, docId: string): Promise<any> {
    const d = await getDb();
    const p = `${collection}/${docId}`;
    const stmt = d.prepare('SELECT data FROM docs WHERE path = ?');
    stmt.bind([p]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return JSON.parse(row.data as string);
    }
    stmt.free();
    return null;
  },

  set(collection: string, docId: string, data: any, options?: { merge?: boolean }): void {
    if (!_db) return;
    const path = `${collection}/${docId}`;
    let finalData = data;
    if (options?.merge) {
      const existing = this.get(collection, docId) || {};
      finalData = deepMerge(existing, data);
    }
    _db.run(
      'INSERT OR REPLACE INTO docs (path, collection_path, doc_id, data) VALUES (?, ?, ?, ?)',
      [path, collection, docId, JSON.stringify(finalData)]
    );
    debouncedSave();
  },

  async setAsync(collection: string, docId: string, data: any, options?: { merge?: boolean }): Promise<void> {
    const d = await getDb();
    const p = `${collection}/${docId}`;
    let finalData = data;
    if (options?.merge) {
      const existing = (await this.getAsync(collection, docId)) || {};
      finalData = deepMerge(existing, data);
    }
    d.run(
      'INSERT OR REPLACE INTO docs (path, collection_path, doc_id, data) VALUES (?, ?, ?, ?)',
      [p, collection, docId, JSON.stringify(finalData)]
    );
    debouncedSave();
  },

  update(collection: string, docId: string, data: any): void {
    if (!_db) return;
    const existing = this.get(collection, docId) || {};
    const path = `${collection}/${docId}`;
    _db.run(
      'INSERT OR REPLACE INTO docs (path, collection_path, doc_id, data) VALUES (?, ?, ?, ?)',
      [path, collection, docId, JSON.stringify({ ...existing, ...data })]
    );
    debouncedSave();
  },

  delete(collection: string, docId: string): void {
    if (!_db) return;
    _db.run('DELETE FROM docs WHERE path = ?', [`${collection}/${docId}`]);
    debouncedSave();
  },

  list(collection: string): Array<{ id: string; data: any }> {
    if (!_db) return [];
    const results: Array<{ id: string; data: any }> = [];
    const stmt = _db.prepare('SELECT doc_id, data FROM docs WHERE collection_path = ?');
    stmt.bind([collection]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({ id: row.doc_id as string, data: JSON.parse(row.data as string) });
    }
    stmt.free();
    return results;
  },

  query(
    collection: string,
    filters?: Array<{ field: string; op: string; value: any }>,
    orderBy?: { field: string; dir: 'asc' | 'desc' },
    limit?: number
  ): Array<{ id: string; data: any }> {
    let docs = this.list(collection);

    if (filters) {
      for (const f of filters) {
        docs = docs.filter(d => matchFilter(getNestedField(d.data, f.field), f.op, f.value));
      }
    }

    if (orderBy) {
      docs.sort((a, b) => {
        const aVal = getNestedField(a.data, orderBy.field);
        const bVal = getNestedField(b.data, orderBy.field);
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return orderBy.dir === 'asc' ? -1 : 1;
        if (bVal == null) return orderBy.dir === 'asc' ? 1 : -1;
        if (aVal < bVal) return orderBy.dir === 'asc' ? -1 : 1;
        if (aVal > bVal) return orderBy.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    if (limit) {
      docs = docs.slice(0, limit);
    }

    return docs;
  },

  // Firestore-compatible collection().doc() API
  collection(name: string) {
    const self = this;
    return {
      doc(id: string) {
        return {
          async get() {
            await ensureDb(); // Wait for db to initialize
            const data = self.get(name, id);
            return { exists: data !== null, data: () => data, id };
          },
          async set(data: any, options?: { merge?: boolean }) {
            await ensureDb();
            self.set(name, id, data, options);
          },
          async update(data: any) {
            await ensureDb();
            self.update(name, id, data);
          },
          async delete() {
            await ensureDb();
            self.delete(name, id);
          },
          collection(subName: string) {
            return self.collection(`${name}/${id}/${subName}`);
          },
        };
      },
      async get() {
        await ensureDb(); // Wait for db to initialize
        const docs = self.list(name);
        return {
          docs: docs.map(d => ({
            id: d.id,
            exists: true,
            data: () => d.data,
            ref: { id: d.id },
          })),
          empty: docs.length === 0,
          size: docs.length,
          forEach(cb: (doc: any) => void) { this.docs.forEach(cb); },
        };
      },
      async add(data: any) {
        await ensureDb();
        const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        self.set(name, id, data);
        return { id };
      },
    };
  },
};

// Export for direct access
export { ensureDb, save };

