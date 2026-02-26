const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { startServer } = require('./server');
const db = require('./db');

let mainWindow = null;
let stickerWindow = null;
let tray = null;
let apiServer = null;

// ── Window creation ──

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#111113',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'windows', 'main', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function createStickerWindow() {
  stickerWindow = new BrowserWindow({
    width: 280,
    height: 540,
    x: 40,
    y: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  stickerWindow.loadFile(path.join(__dirname, 'windows', 'sticker', 'index.html'));
  stickerWindow.once('ready-to-show', () => stickerWindow.show());

  stickerWindow.on('close', (e) => {
    e.preventDefault();
    stickerWindow.hide();
  });
}

// ── Tray ──

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Orbit');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Orbit 열기', click: () => mainWindow && mainWindow.show() },
    { label: '스티커 표시/숨기기', click: () => toggleSticker() },
    { type: 'separator' },
    { label: '종료', click: () => quitApp() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow && mainWindow.show());
}

function toggleSticker() {
  if (!stickerWindow) return;
  if (stickerWindow.isVisible()) {
    stickerWindow.hide();
  } else {
    stickerWindow.show();
  }
}

function quitApp() {
  if (mainWindow) { mainWindow.removeAllListeners('close'); mainWindow.close(); }
  if (stickerWindow) { stickerWindow.removeAllListeners('close'); stickerWindow.close(); }
  if (apiServer) apiServer.close();
  db.close();
  app.quit();
}

// ── Notify sticker of changes ──

function notifyStickerRefresh() {
  if (stickerWindow && !stickerWindow.isDestroyed()) {
    stickerWindow.webContents.send('tasks-changed');
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tasks-changed');
  }
}

// ── IPC Handlers ──

function registerIPC() {
  ipcMain.handle('get-projects', () => db.getAllProjects());
  ipcMain.handle('create-project', (_e, data) => db.createProject(data));
  ipcMain.handle('delete-project', (_e, id) => db.deleteProject(id));

  ipcMain.handle('get-tasks-today', () => db.getTodayTasks());
  ipcMain.handle('get-tasks-by-date', (_e, date) => db.getTasksByDate(date));
  ipcMain.handle('get-tasks-by-project', (_e, projectId) => db.getTasksByProject(projectId));
  ipcMain.handle('get-subtasks', (_e, parentId) => db.getSubtasks(parentId));
  ipcMain.handle('get-completed-by-month', (_e, year, month) => db.getCompletedTasksByMonth(year, month));
  ipcMain.handle('create-task', (_e, data) => {
    const task = db.createTask(data);
    notifyStickerRefresh();
    return task;
  });
  ipcMain.handle('update-task', (_e, id, fields) => {
    const task = db.updateTask(id, fields);
    notifyStickerRefresh();
    return task;
  });
  ipcMain.handle('delete-task', (_e, id) => {
    db.deleteTask(id);
    notifyStickerRefresh();
    return { ok: true };
  });

  ipcMain.on('show-main', () => mainWindow && mainWindow.show());
  ipcMain.on('toggle-sticker', () => toggleSticker());
  ipcMain.handle('toggle-sticker-pin', () => {
    if (!stickerWindow) return false;
    const current = stickerWindow.isAlwaysOnTop();
    stickerWindow.setAlwaysOnTop(!current);
    return !current;
  });
}

// ── Korean Menu ──

function createAppMenu() {
  const template = [
    {
      label: '파일',
      submenu: [
        { label: '새 작업', accelerator: 'CmdOrCtrl+N', click: () => mainWindow && mainWindow.webContents.send('focus-new-task') },
        { type: 'separator' },
        { label: '스티커 표시/숨기기', accelerator: 'CmdOrCtrl+Shift+S', click: () => toggleSticker() },
        { type: 'separator' },
        { label: '종료', accelerator: 'CmdOrCtrl+Q', click: () => quitApp() },
      ],
    },
    {
      label: '편집',
      submenu: [
        { label: '실행 취소', role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { label: '다시 실행', role: 'redo', accelerator: 'CmdOrCtrl+Shift+Z' },
        { type: 'separator' },
        { label: '잘라내기', role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { label: '복사', role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { label: '붙여넣기', role: 'paste', accelerator: 'CmdOrCtrl+V' },
        { label: '전체 선택', role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '새로고침', role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { label: '강제 새로고침', role: 'forceReload', accelerator: 'CmdOrCtrl+Shift+R' },
        { type: 'separator' },
        { label: '확대', role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { label: '축소', role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { label: '원래 크기', role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
        { type: 'separator' },
        { label: '전체 화면', role: 'togglefullscreen', accelerator: 'F11' },
        { type: 'separator' },
        { label: '개발자 도구', role: 'toggleDevTools', accelerator: 'F12' },
      ],
    },
    {
      label: '창',
      submenu: [
        { label: '최소화', role: 'minimize' },
        { label: '닫기', role: 'close' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App lifecycle ──

app.whenReady().then(async () => {
  registerIPC();
  createAppMenu();

  apiServer = await startServer(notifyStickerRefresh);

  createMainWindow();
  createStickerWindow();
  createTray();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
