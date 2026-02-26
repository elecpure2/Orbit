const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'orbit.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function migrate() {
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  if (cols.length > 0 && !cols.includes('parent_id')) {
    db.exec("ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE");
  }
  if (cols.length > 0 && !cols.includes('stopwatch_elapsed')) {
    db.exec("ALTER TABLE tasks ADD COLUMN stopwatch_elapsed INTEGER DEFAULT 0");
  }
  if (cols.length > 0 && !cols.includes('stopwatch_started_at')) {
    db.exec("ALTER TABLE tasks ADD COLUMN stopwatch_started_at TEXT");
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

// ── Tasks ──

function getTasksByDate(date) {
  const db = getDb();
  const parents = db.prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.target_date = ? AND t.parent_id IS NULL
    ORDER BY
      CASE t.priority WHEN 'must' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      t.created_at ASC
  `).all(date);

  return attachSubtasks(parents);
}

function getTodayTasks() {
  const today = new Date().toISOString().slice(0, 10);
  return getTasksByDate(today);
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

  const today = new Date().toISOString().slice(0, 10);
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

function getCompletedTasksByMonth(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  return getDb().prepare(`
    SELECT t.id, t.parent_id, t.title, t.description, t.completed_at,
           t.estimate_minutes, t.actual_minutes, t.status, t.target_date, t.project_id,
           p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'done'
      AND t.completed_at >= ? AND t.completed_at < ?
    ORDER BY t.completed_at ASC
  `).all(start, end);
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
