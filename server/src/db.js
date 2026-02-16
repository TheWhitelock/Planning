import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const initSqlJs = require('sql.js');
const resolveWasm = () => require.resolve('sql.js/dist/sql-wasm.wasm');
const SCHEMA_VERSION = 2;
const DEFAULT_SUBPROJECT_NAME = 'Main';

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

const queryAll = (db, sql, params = []) => {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
};

const tableExists = (db, tableName) =>
  queryAll(
    db,
    `SELECT 1 AS present
     FROM sqlite_master
     WHERE type = 'table' AND name = ?
     LIMIT 1`,
    [tableName]
  ).length > 0;

const tableHasColumn = (db, tableName, columnName) =>
  queryAll(db, `PRAGMA table_info(${tableName});`).some((column) => column.name === columnName);

const ensureBaseTables = (db) => {
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

  try {
    db.run('ALTER TABLE activities ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;');
  } catch {
    // Column already exists.
  }
  db.run('UPDATE activities SET sortOrder = id WHERE sortOrder IS NULL OR sortOrder = 0;');

  db.run(`
    CREATE TABLE IF NOT EXISTS subprojects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
  `);
};

const ensureMainSubprojectPerProject = (db) => {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO subprojects (projectId, name, sortOrder, createdAt)
     SELECT p.id,
            ?,
            COALESCE(
              (
                SELECT MAX(s.sortOrder) + 1
                FROM subprojects s
                WHERE s.projectId = p.id
              ),
              1
            ),
            ?
     FROM projects p
     WHERE NOT EXISTS (
       SELECT 1
       FROM subprojects s
       WHERE s.projectId = p.id
         AND LOWER(s.name) = LOWER(?)
     )`,
    [DEFAULT_SUBPROJECT_NAME, now, DEFAULT_SUBPROJECT_NAME]
  );
  db.run('UPDATE subprojects SET sortOrder = id WHERE sortOrder IS NULL OR sortOrder = 0;');
};

const createActivityInstancesTable = (db) => {
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subProjectId INTEGER NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
      activityId INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      UNIQUE(subProjectId, activityId, day)
    );
  `);
};

const migrateActivityInstances = (db) => {
  if (!tableExists(db, 'activity_instances')) {
    createActivityInstancesTable(db);
    return;
  }

  if (!tableHasColumn(db, 'activity_instances', 'subProjectId')) {
    db.run('ALTER TABLE activity_instances RENAME TO activity_instances_legacy;');
    createActivityInstancesTable(db);
    db.run(
      `INSERT INTO activity_instances (id, subProjectId, activityId, day, createdAt)
       SELECT ai.id, sp.id, ai.activityId, ai.day, ai.createdAt
       FROM activity_instances_legacy ai
       JOIN activities a ON a.id = ai.activityId
       JOIN subprojects sp
         ON sp.projectId = a.projectId
        AND LOWER(sp.name) = LOWER(?)`,
      [DEFAULT_SUBPROJECT_NAME]
    );
    db.run('DROP TABLE activity_instances_legacy;');
    return;
  }

  // Safety net for databases that had transitional nullable values.
  db.run(
    `UPDATE activity_instances
     SET subProjectId = (
       SELECT sp.id
       FROM activities a
       JOIN subprojects sp
         ON sp.projectId = a.projectId
        AND LOWER(sp.name) = LOWER(?)
       WHERE a.id = activity_instances.activityId
       LIMIT 1
     )
     WHERE subProjectId IS NULL`,
    [DEFAULT_SUBPROJECT_NAME]
  );
};

const ensureIndexes = (db) => {
  db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_project_name ON activities(projectId, name COLLATE NOCASE);'
  );
  db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_subprojects_project_name ON subprojects(projectId, name COLLATE NOCASE);'
  );
  db.run('CREATE INDEX IF NOT EXISTS idx_projects_date_range ON projects(startDate, endDate);');
  db.run('CREATE INDEX IF NOT EXISTS idx_activities_project_id ON activities(projectId);');
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_activities_project_order ON activities(projectId, sortOrder, id);'
  );
  db.run('CREATE INDEX IF NOT EXISTS idx_subprojects_project_id ON subprojects(projectId);');
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_subprojects_project_order ON subprojects(projectId, sortOrder, id);'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_instances_subproject_day ON activity_instances(subProjectId, day);'
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_instances_activity_subproject_day ON activity_instances(activityId, subProjectId, day);'
  );
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

  ensureBaseTables(db);
  ensureMainSubprojectPerProject(db);
  migrateActivityInstances(db);
  ensureIndexes(db);
  const userVersion = queryAll(db, 'PRAGMA user_version;')[0]?.user_version || 0;
  if (userVersion < SCHEMA_VERSION) {
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  exportDatabase(db, filePath);

  let writeQueue = Promise.resolve();

  const enqueueWrite = (fn) => {
    writeQueue = writeQueue.then(fn, fn);
    return writeQueue;
  };

  const all = (sql, params = []) => queryAll(db, sql, params);

  const run = (sql, params = []) =>
    enqueueWrite(() => {
      db.run(sql, params);
      exportDatabase(db, filePath);
    });

  return { all, run, db, filePath };
};
