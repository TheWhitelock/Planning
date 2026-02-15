import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const initSqlJs = require('sql.js');
const resolveWasm = () => require.resolve('sql.js/dist/sql-wasm.wasm');

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const exportDatabase = (db, filePath) => {
  const data = db.export();
  const tempPath = `${filePath}.tmp`;
  const buffer = Buffer.from(data);
  fs.writeFileSync(tempPath, buffer);
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Some Windows environments block rename over existing files.
    if (error?.code !== 'EPERM') {
      throw error;
    }
    fs.writeFileSync(filePath, buffer);
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
};

export const createDatabase = async (filePath) => {
  ensureDir(filePath);

  const SQL = await initSqlJs({
    locateFile: () => resolveWasm()
  });

  const exists = fs.existsSync(filePath);
  const fileBuffer = exists ? fs.readFileSync(filePath) : null;
  const db = new SQL.Database(fileBuffer || undefined);

  db.run('PRAGMA foreign_keys = ON;');

  db.run('DROP TABLE IF EXISTS clock_events;');
  db.run('DROP INDEX IF EXISTS idx_clock_events_occurred_at;');

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      lengthDays INTEGER NOT NULL CHECK (lengthDays >= 1),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Backfill ordering for databases created before the sortOrder column existed.
  try {
    db.run('ALTER TABLE activities ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;');
  } catch {
    // Column already exists.
  }
  db.run('UPDATE activities SET sortOrder = id WHERE sortOrder IS NULL OR sortOrder = 0;');

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activityId INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      UNIQUE(activityId, day)
    );
  `);

  db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_project_name ON activities(projectId, name COLLATE NOCASE);'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_projects_date_range ON projects(startDate, endDate);'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_activities_project_id ON activities(projectId);'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_activities_project_order ON activities(projectId, sortOrder, id);'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_instances_activity_day ON activity_instances(activityId, day);'
  );

  exportDatabase(db, filePath);

  let writeQueue = Promise.resolve();

  const enqueueWrite = (fn) => {
    writeQueue = writeQueue.then(fn, fn);
    return writeQueue;
  };

  const all = (sql, params = []) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  };

  const run = (sql, params = []) =>
    enqueueWrite(() => {
      db.run(sql, params);
      exportDatabase(db, filePath);
    });

  return { all, run, db, filePath };
};
