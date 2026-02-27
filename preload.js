const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbit', {
  // Projects
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (data) => ipcRenderer.invoke('create-project', data),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),

  // Notes
  getNotes: (projectId) => ipcRenderer.invoke('get-notes', projectId),
  createNote: (data) => ipcRenderer.invoke('create-note', data),
  updateNote: (id, fields) => ipcRenderer.invoke('update-note', id, fields),
  deleteNote: (id) => ipcRenderer.invoke('delete-note', id),

  // Tasks
  getTodayTasks: (projectId) => ipcRenderer.invoke('get-tasks-today', projectId),
  getTasksByDate: (date, projectId) => ipcRenderer.invoke('get-tasks-by-date', date, projectId),
  getTasksByProject: (projectId) => ipcRenderer.invoke('get-tasks-by-project', projectId),
  getSubtasks: (parentId) => ipcRenderer.invoke('get-subtasks', parentId),
  getCompletedByMonth: (year, month, projectId) => ipcRenderer.invoke('get-completed-by-month', year, month, projectId),
  createTask: (data) => ipcRenderer.invoke('create-task', data),
  updateTask: (id, fields) => ipcRenderer.invoke('update-task', id, fields),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),

  // Events
  onTasksChanged: (callback) => {
    ipcRenderer.on('tasks-changed', callback);
    return () => ipcRenderer.removeListener('tasks-changed', callback);
  },
  onFocusNewTask: (callback) => {
    ipcRenderer.on('focus-new-task', callback);
    return () => ipcRenderer.removeListener('focus-new-task', callback);
  },
  onNotesChanged: (callback) => {
    ipcRenderer.on('notes-changed', callback);
    return () => ipcRenderer.removeListener('notes-changed', callback);
  },

  // Window controls
  showMain: () => ipcRenderer.send('show-main'),
  toggleSticker: () => ipcRenderer.send('toggle-sticker'),
  togglePin: () => ipcRenderer.invoke('toggle-sticker-pin'),
});
