const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'fuara.db');
const LEGACY_DB_PATH = path.join(__dirname, 'orbit.db');

let db;

function localDateYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function safeMoveFile(src, dst) {
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dst)) return;
  fs.renameSync(src, dst);
}

function migrateDbFileIfNeeded() {
  if (fs.existsSync(DB_PATH)) return;
  if (!fs.existsSync(LEGACY_DB_PATH)) return;

  try {
    safeMoveFile(LEGACY_DB_PATH, DB_PATH);
    safeMoveFile(`${LEGACY_DB_PATH}-wal`, `${DB_PATH}-wal`);
    safeMoveFile(`${LEGACY_DB_PATH}-shm`, `${DB_PATH}-shm`);
    safeMoveFile(`${LEGACY_DB_PATH}-journal`, `${DB_PATH}-journal`);
    console.log('[FUARA][DB] Migrated orbit.db -> fuara.db');
  } catch (e) {
    // Keep app usable even if rename fails in some environments
    console.warn(`[FUARA][DB] Migration skipped: ${e.message}`);
  }
}

function pickNewerDbPath() {
  const newMtime = fs.statSync(DB_PATH).mtimeMs;
  const legacyMtime = fs.statSync(LEGACY_DB_PATH).mtimeMs;
  return legacyMtime > newMtime ? LEGACY_DB_PATH : DB_PATH;
}

function readParentTaskCount(dbPath) {
  if (!fs.existsSync(dbPath)) return -1;

  let tempDb = null;
  try {
    tempDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    const hasTasks = tempDb.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks' LIMIT 1"
    ).get();
    if (!hasTasks) return 0;

    const row = tempDb.prepare(
      "SELECT COUNT(*) AS c FROM tasks WHERE parent_id IS NULL"
    ).get();
    return Number(row?.c || 0);
  } catch (_e) {
    return -1;
  } finally {
    if (tempDb) tempDb.close();
  }
}

function pickDataRichDbPath() {
  const newCount = readParentTaskCount(DB_PATH);
  const legacyCount = readParentTaskCount(LEGACY_DB_PATH);
  if (newCount === legacyCount) return null;
  return legacyCount > newCount ? LEGACY_DB_PATH : DB_PATH;
}

function resolveDbPath() {
  migrateDbFileIfNeeded();

  const hasNew = fs.existsSync(DB_PATH);
  const hasLegacy = fs.existsSync(LEGACY_DB_PATH);

  if (hasNew && hasLegacy) {
    const dataRich = pickDataRichDbPath();
    if (dataRich) {
      const chosenName = path.basename(dataRich);
      const newCount = readParentTaskCount(DB_PATH);
      const legacyCount = readParentTaskCount(LEGACY_DB_PATH);
      console.warn(
        `[FUARA][DB] Both DB files exist. Using task-rich file: ${chosenName} (fuara=${newCount}, orbit=${legacyCount})`
      );
      return dataRich;
    }

    const chosen = pickNewerDbPath();
    const chosenName = path.basename(chosen);
    console.warn(`[FUARA][DB] Both DB files exist. Using newer file: ${chosenName}`);
    return chosen;
  }

  if (hasNew) return DB_PATH;
  if (hasLegacy) return LEGACY_DB_PATH;
  return DB_PATH;
}

function mergeNotesFromOtherDb(activeDbPath) {
  const otherDbPath = activeDbPath === DB_PATH ? LEGACY_DB_PATH : DB_PATH;
  if (!fs.existsSync(otherDbPath)) return;

  let sourceDb = null;
  try {
    const current = db.prepare("SELECT COUNT(*) AS c FROM notes").get();
    if (Number(current?.c || 0) > 0) return;

    sourceDb = new Database(otherDbPath, { readonly: true, fileMustExist: true });
    const hasNotes = sourceDb.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes' LIMIT 1"
    ).get();
    if (!hasNotes) return;

    const rows = sourceDb.prepare(
      "SELECT title, content, category, pinned, created_at, updated_at FROM notes ORDER BY id ASC"
    ).all();
    if (!rows || rows.length === 0) return;

    const insert = db.prepare(`
      INSERT INTO notes (title, content, category, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((items) => {
      for (const n of items) {
        insert.run(
          n.title,
          n.content || null,
          n.category || 'memo',
          n.pinned ? 1 : 0,
          n.created_at || null,
          n.updated_at || null
        );
      }
    });
    tx(rows);
    console.log(`[FUARA][DB] Merged ${rows.length} notes from ${path.basename(otherDbPath)}.`);
  } catch (e) {
    console.warn(`[FUARA][DB] Note merge skipped: ${e.message}`);
  } finally {
    if (sourceDb) sourceDb.close();
  }
}

function getDb() {
  if (!db) {
    const resolvedPath = resolveDbPath();
    db = new Database(resolvedPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
    mergeNotesFromOtherDb(resolvedPath);
  }
  return db;
}

function migrate() {
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  if (taskCols.length > 0 && !taskCols.includes('parent_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE");
  }
  if (taskCols.length > 0 && !taskCols.includes('stopwatch_elapsed')) {
    db.exec("ALTER TABLE tasks ADD COLUMN stopwatch_elapsed INTEGER DEFAULT 0");
  }
  if (taskCols.length > 0 && !taskCols.includes('stopwatch_started_at')) {
    db.exec("ALTER TABLE tasks ADD COLUMN stopwatch_started_at TEXT");
  }

  const noteCols = db.prepare("PRAGMA table_info(notes)").all().map(c => c.name);
  if (noteCols.length > 0 && !noteCols.includes('project_id')) {
    db.exec("ALTER TABLE notes ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
  }
}

function initTables() {
  migrate();
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      folder_path TEXT,
      tech_stack TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      estimate_minutes INTEGER,
      actual_minutes INTEGER,
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'pending',
      target_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      category TEXT DEFAULT 'memo',
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}

// ── Projects ──

function getAllProjects() {
  return getDb().prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
}

function getProjectByName(name) {
  return getDb().prepare('SELECT * FROM projects WHERE name = ?').get(name);
}

function createProject({ name, folder_path, tech_stack }) {
  const info = getDb().prepare(
    'INSERT INTO projects (name, folder_path, tech_stack) VALUES (?, ?, ?)'
  ).run(name, folder_path || null, tech_stack || null);
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
}

function deleteProject(id) {
  return getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

// ── Notes ──

function getAllNotes(projectId) {
  if (projectId) {
    return getDb().prepare(`
      SELECT n.*, p.name AS project_name
      FROM notes n
      LEFT JOIN projects p ON n.project_id = p.id
      WHERE n.project_id = ?
      ORDER BY n.pinned DESC, n.updated_at DESC, n.created_at DESC
    `).all(projectId);
  }
  return getDb().prepare(`
    SELECT n.*, p.name AS project_name
    FROM notes n
    LEFT JOIN projects p ON n.project_id = p.id
    ORDER BY n.pinned DESC, n.updated_at DESC, n.created_at DESC
  `).all();
}

function createNote({ title, content, category, pinned, project_id }) {
  const info = getDb().prepare(`
    INSERT INTO notes (title, content, category, pinned, project_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    title,
    content || null,
    category || 'memo',
    pinned ? 1 : 0,
    project_id || null
  );

  return getDb().prepare(`
    SELECT n.*, p.name AS project_name
    FROM notes n LEFT JOIN projects p ON n.project_id = p.id
    WHERE n.id = ?
  `).get(info.lastInsertRowid);
}

function updateNote(id, fields) {
  const db = getDb();
  const allowed = ['title', 'content', 'category', 'pinned', 'project_id'];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(key === 'pinned' ? (fields[key] ? 1 : 0) : fields[key]);
    }
  }

  if (sets.length === 0) return null;
  sets.push("updated_at = datetime('now','localtime')");
  values.push(id);

  db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
}

function deleteNote(id) {
  return getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
}

// ── Tasks ──

function getTasksByDate(date, projectId) {
  const db = getDb();
  let sql = `
    SELECT t.*, p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.parent_id IS NULL
      AND (t.target_date = ? OR (t.target_date < ? AND t.status = 'pending'))
  `;
  const params = [date, date];
  if (projectId) { sql += ' AND t.project_id = ?'; params.push(projectId); }
  sql += `
    ORDER BY
      CASE t.priority WHEN 'must' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      t.target_date ASC,
      t.created_at ASC
  `;
  return attachSubtasks(db.prepare(sql).all(...params));
}

function getTodayTasks(projectId) {
  const today = localDateYmd();
  let sql = `
    SELECT t.*, p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.parent_id IS NULL
      AND t.status = 'pending'
      AND (t.target_date IS NULL OR t.target_date <= ?)
  `;
  const params = [today];
  if (projectId) { sql += ' AND t.project_id = ?'; params.push(projectId); }
  sql += `
    ORDER BY
      CASE t.priority WHEN 'must' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      t.target_date DESC,
      t.created_at ASC
  `;
  return attachSubtasks(getDb().prepare(sql).all(...params));
}

function getTasksByProject(projectId) {
  const parents = getDb().prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.project_id = ? AND t.parent_id IS NULL
    ORDER BY target_date DESC, created_at ASC
  `).all(projectId);

  return attachSubtasks(parents);
}

function getSubtasks(parentId) {
  return getDb().prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.parent_id = ?
    ORDER BY t.created_at ASC
  `).all(parentId);
}

function attachSubtasks(parents) {
  return parents.map(p => {
    const subs = getSubtasks(p.id);
    return { ...p, subtasks: subs };
  });
}

function createTask({ parent_id, project_id, project, title, description, estimate_minutes, priority, target_date, status, subtasks }) {
  const db = getDb();

  let resolvedProjectId = project_id || null;
  if (!resolvedProjectId && project) {
    let p = getProjectByName(project);
    if (!p) {
      p = createProject({ name: project });
    }
    resolvedProjectId = p.id;
  }

  const today = localDateYmd();
  const resolvedDate = target_date || today;
  const resolvedStatus = status || 'pending';

  const info = db.prepare(`
    INSERT INTO tasks (parent_id, project_id, title, description, estimate_minutes, priority, target_date, status, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parent_id || null,
    resolvedProjectId,
    title,
    description || null,
    estimate_minutes || null,
    priority || 'normal',
    resolvedDate,
    resolvedStatus,
    resolvedStatus === 'done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null
  );

  const parentTaskId = info.lastInsertRowid;

  if (subtasks && subtasks.length > 0) {
    for (const sub of subtasks) {
      db.prepare(`
        INSERT INTO tasks (parent_id, project_id, title, description, estimate_minutes, priority, target_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        parentTaskId,
        resolvedProjectId,
        sub.title,
        sub.description || null,
        sub.estimate_minutes || null,
        sub.priority || priority || 'normal',
        resolvedDate
      );
    }
  }

  const task = db.prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.id = ?
  `).get(parentTaskId);

  task.subtasks = getSubtasks(parentTaskId);
  return task;
}

function updateTask(id, fields) {
  const db = getDb();
  const allowed = ['title', 'description', 'estimate_minutes', 'actual_minutes', 'priority', 'status', 'target_date', 'stopwatch_elapsed', 'stopwatch_started_at'];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }

  if (fields.status === 'done') {
    sets.push("completed_at = datetime('now','localtime')");
  }

  if (sets.length === 0) return null;
  values.push(id);

  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  return db.prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.id = ?
  `).get(id);
}

function deleteTask(id) {
  const db = getDb();
  db.prepare('DELETE FROM tasks WHERE parent_id = ?').run(id);
  return db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

function getCompletedTasksByMonth(year, month, projectId) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  let sql = `
    SELECT t.id, t.parent_id, t.title, t.description, t.completed_at,
           t.estimate_minutes, t.actual_minutes, t.status, t.target_date, t.project_id,
           p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'done'
      AND t.completed_at >= ? AND t.completed_at < ?
  `;
  const params = [start, end];
  if (projectId) { sql += ' AND t.project_id = ?'; params.push(projectId); }
  sql += ' ORDER BY t.completed_at ASC';
  return getDb().prepare(sql).all(...params);
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  getAllProjects,
  getProjectByName,
  createProject,
  deleteProject,
  getAllNotes,
  createNote,
  updateNote,
  deleteNote,
  getTasksByDate,
  getTodayTasks,
  getTasksByProject,
  getSubtasks,
  createTask,
  updateTask,
  deleteTask,
  getCompletedTasksByMonth,
  close,
};
