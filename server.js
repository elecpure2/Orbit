const express = require('express');
const cors = require('cors');
const db = require('./db');

const PORT = 7777;

function createServer(onTaskChange) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── Projects ──

  app.get('/projects', (_req, res) => {
    res.json(db.getAllProjects());
  });

  app.post('/projects', (req, res) => {
    const { name, folder_path, tech_stack } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
      const project = db.createProject({ name, folder_path, tech_stack });
      res.status(201).json(project);
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Project already exists' });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/projects/:id', (req, res) => {
    db.deleteProject(req.params.id);
    res.json({ ok: true });
  });

  // ── Notes ──

  app.get('/notes', (_req, res) => {
    res.json(db.getAllNotes());
  });

  app.post('/notes', (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    try {
      const note = db.createNote(req.body);
      if (onTaskChange) onTaskChange();
      res.status(201).json(note);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/notes/:id', (req, res) => {
    const note = db.updateNote(Number(req.params.id), req.body);
    if (!note) return res.status(404).json({ error: 'Note not found or no changes' });
    if (onTaskChange) onTaskChange();
    res.json(note);
  });

  app.delete('/notes/:id', (req, res) => {
    db.deleteNote(Number(req.params.id));
    if (onTaskChange) onTaskChange();
    res.json({ ok: true });
  });

  // ── Tasks ──

  app.get('/tasks/today', (_req, res) => {
    res.json(db.getTodayTasks());
  });

  app.get('/tasks', (req, res) => {
    const { date, project_id } = req.query;
    if (project_id) return res.json(db.getTasksByProject(project_id));
    if (date) return res.json(db.getTasksByDate(date));
    res.json(db.getTodayTasks());
  });

  app.post('/tasks', (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    try {
      const task = db.createTask(req.body);
      if (onTaskChange) onTaskChange();
      res.status(201).json(task);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/tasks/:id', (req, res) => {
    const task = db.updateTask(Number(req.params.id), req.body);
    if (!task) return res.status(404).json({ error: 'Task not found or no changes' });
    if (onTaskChange) onTaskChange();
    res.json(task);
  });

  app.delete('/tasks/:id', (req, res) => {
    db.deleteTask(Number(req.params.id));
    if (onTaskChange) onTaskChange();
    res.json({ ok: true });
  });

  // ── Health ──

  app.get('/ping', (_req, res) => {
    res.json({ status: 'ok', app: 'fuara' });
  });

  return app;
}

function startServer(onTaskChange) {
  const app = createServer(onTaskChange);
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[FUARA] API server running at http://127.0.0.1:${PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { startServer, PORT };
