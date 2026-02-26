const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentView = 'today';
let currentProjectId = null;
let currentDate = new Date().toISOString().slice(0, 10);
const expandedTasks = new Set();

let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth() + 1;

// ── Init ──

async function init() {
  await loadProjects();
  await loadTasks();
  bindEvents();

  $('#date-picker').value = currentDate;

  window.orbit.onTasksChanged(() => loadTasks());
  window.orbit.onFocusNewTask(() => $('#new-task-title').focus());
}

// ── Projects ──

async function loadProjects() {
  const projects = await window.orbit.getProjects();
  const list = $('#project-list');
  list.innerHTML = '';

  projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'sidebar-item project-item';
    btn.dataset.view = 'project';
    btn.dataset.projectId = p.id;
    btn.innerHTML = `
      <span><span class="sidebar-icon">&#9671;</span> ${escHtml(p.name)}</span>
      <span class="btn-delete-project" data-id="${p.id}" title="삭제">&times;</span>
    `;
    list.appendChild(btn);
  });
}

// ── Tasks ──

async function loadTasks() {
  const taskList = $('#task-list');
  const calView = $('#calendar-view');
  const addBar = document.querySelector('.add-task-bar');

  if (currentView === 'calendar') {
    taskList.classList.add('hidden');
    calView.classList.remove('hidden');
    addBar.classList.add('hidden');
    $('#view-title').textContent = `${calendarYear}년 ${calendarMonth}월`;
    await renderCalendar();
    return;
  }

  taskList.classList.remove('hidden');
  calView.classList.add('hidden');
  addBar.classList.remove('hidden');

  let tasks;

  if (currentView === 'today') {
    tasks = await window.orbit.getTodayTasks();
    $('#view-title').textContent = '오늘 할 일';
  } else if (currentView === 'project' && currentProjectId) {
    tasks = await window.orbit.getTasksByProject(currentProjectId);
    const projects = await window.orbit.getProjects();
    const proj = projects.find(p => p.id === currentProjectId);
    $('#view-title').textContent = proj ? proj.name : '프로젝트';
  } else {
    tasks = await window.orbit.getTasksByDate(currentDate);
    $('#view-title').textContent = currentDate;
  }

  renderTasks(tasks);
  renderInProgress(tasks);
}

function renderInProgress(tasks) {
  const section = $('#in-progress-section');
  if (!tasks) { section.classList.add('hidden'); return; }

  const running = [];
  for (const t of tasks) {
    if (t.stopwatch_started_at && t.status !== 'done') {
      running.push({ ...t, _parentTitle: null });
    }
    if (t.subtasks) {
      for (const s of t.subtasks) {
        if (s.stopwatch_started_at && s.status !== 'done') {
          running.push({ ...s, _parentTitle: t.title });
        }
      }
    }
  }

  if (running.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  section.innerHTML = `
    <div class="ip-header">진행 중</div>
    ${running.map(t => {
      const elapsed = t.stopwatch_elapsed || 0;
      const started = t.stopwatch_started_at || '';
      return `
      <div class="ip-card" data-id="${t.id}" data-sw-elapsed="${elapsed}" data-sw-started="${started}">
        <div class="ip-top">
          ${t._parentTitle ? `<span class="ip-parent">${escHtml(t._parentTitle)} ›</span>` : ''}
          <span class="ip-title">${escHtml(t.title)}</span>
        </div>
        ${t.description ? `<div class="ip-desc">${escHtml(t.description)}</div>` : ''}
        <div class="ip-bottom">
          <span class="sw-display running ip-timer" data-sw-elapsed="${elapsed}" data-sw-started="${started}">${formatSec(calcElapsed(elapsed, started))}</span>
          <div class="ip-actions">
            <button class="ip-btn ip-pause" data-id="${t.id}">⏸ 일시정지</button>
            <button class="ip-btn ip-complete" data-id="${t.id}">✓ 완료</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  `;

  section.querySelectorAll('.ip-pause').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const card = btn.closest('.ip-card');
      const elapsed = Number(card.dataset.swElapsed) || 0;
      const started = card.dataset.swStarted;
      const total = calcElapsed(elapsed, started);
      await window.orbit.updateTask(id, { stopwatch_elapsed: total, stopwatch_started_at: null });
    });
  });

  section.querySelectorAll('.ip-complete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const card = btn.closest('.ip-card');
      await completeTaskWithStopwatch(id, card);
    });
  });
}

function renderTasks(tasks) {
  const list = $('#task-list');
  const activeTasks = (tasks || []).filter(t => t.status !== 'done');

  if (activeTasks.length === 0) {
    list.innerHTML = '<div class="empty-state">할 일이 없습니다</div>';
    updateStatus(0, 0);
    return;
  }

  list.innerHTML = activeTasks.map(t => renderTaskCard(t)).join('');

  const allPending = [];
  activeTasks.forEach(t => {
    allPending.push(t);
    if (t.subtasks) t.subtasks.filter(s => s.status !== 'done').forEach(s => allPending.push(s));
  });
  const totalMin = allPending.reduce((s, t) => s + (t.estimate_minutes || 0), 0);
  updateStatus(allPending.length, totalMin);
}

function renderTaskCard(t) {
  const hasSubs = t.subtasks && t.subtasks.length > 0;
  const isExpanded = expandedTasks.has(t.id);
  const doneCount = hasSubs ? t.subtasks.filter(s => s.status === 'done').length : 0;
  const totalCount = hasSubs ? t.subtasks.length : 0;
  const progress = hasSubs ? Math.round((doneCount / totalCount) * 100) : 0;

  let subsHtml = '';
  if (isExpanded) {
    const subsItems = (t.subtasks || []).map(s => {
      const sSw = s.stopwatch_elapsed || 0;
      const sSwStarted = s.stopwatch_started_at || '';
      const sSwActive = sSw > 0 || sSwStarted;
      const sSwClass = sSwStarted ? 'running' : (sSw > 0 ? 'paused' : '');
      const sDoneTime = (s.status === 'done' && s.actual_minutes) ? `<span class="actual-time-badge">⏱ ${formatMinutes(s.actual_minutes)}</span>` : '';
      return `
      <div class="subtask-item ${s.status === 'done' ? 'done' : ''}" data-id="${s.id}" data-sw-elapsed="${sSw}" data-sw-started="${sSwStarted}">
        <div class="subtask-row">
          <button class="task-check sub-check ${s.status === 'done' ? 'checked' : ''}" data-id="${s.id}">&#10003;</button>
          <span class="subtask-title editable-title" data-id="${s.id}">${escHtml(s.title)}</span>
          ${sSwActive ? `<span class="sw-display sw-sub ${sSwClass}" data-sw-elapsed="${sSw}" data-sw-started="${sSwStarted}">${formatSec(calcElapsed(sSw, sSwStarted))}</span>` : ''}
          ${sDoneTime}
          <input type="number" class="subtask-est-input" data-id="${s.id}" value="${s.estimate_minutes || ''}" placeholder="분" min="0" />
          <button class="btn-task-action btn-delete-task" data-id="${s.id}" title="삭제">&times;</button>
        </div>
        ${s.description ? `<div class="subtask-desc">${escHtml(s.description)}</div>` : ''}
      </div>
    `}).join('');

    subsHtml = `
      <div class="subtask-list">
        ${subsItems}
        <div class="subtask-add-row">
          <input type="text" class="subtask-input" data-parent="${t.id}" placeholder="서브태스크 추가..." />
        </div>
      </div>
    `;
  }

  const swElapsed = t.stopwatch_elapsed || 0;
  const swStarted = t.stopwatch_started_at || '';
  const swActive = swElapsed > 0 || swStarted;
  const swClass = swStarted ? 'running' : (swElapsed > 0 ? 'paused' : '');

  return `
    <div class="task-card ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}" data-has-subs="${hasSubs ? '1' : ''}" data-sw-elapsed="${swElapsed}" data-sw-started="${swStarted}">
      <div class="task-row">
        <button class="task-check ${t.status === 'done' ? 'checked' : ''}" data-id="${t.id}">&#10003;</button>
        <button class="btn-expand ${isExpanded ? 'expanded' : ''}" data-id="${t.id}">${isExpanded ? '&#9660;' : '&#9654;'}</button>
        <span class="task-title-text" data-id="${t.id}">${escHtml(t.title)}</span>
        <span class="task-meta-inline">
          ${swActive ? `<span class="sw-display ${swClass}" data-sw-elapsed="${swElapsed}" data-sw-started="${swStarted}">${formatSec(calcElapsed(swElapsed, swStarted))}</span>` : ''}
          ${hasSubs ? `<span class="progress-badge">${doneCount}/${totalCount}</span>` : ''}
          <span class="badge badge-${t.priority}">${priorityLabel(t.priority)}</span>
          ${t.estimate_minutes ? `<span class="task-estimate">${formatMinutes(t.estimate_minutes)}</span>` : ''}
          ${t.project_name ? `<span class="task-project">${escHtml(t.project_name)}</span>` : ''}
        </span>
        <div class="task-actions">
          <button class="btn-task-action btn-add-sub" data-id="${t.id}" title="서브태스크 추가">+</button>
          <button class="btn-task-action btn-delete-task" data-id="${t.id}" title="삭제">&times;</button>
        </div>
      </div>
      ${hasSubs ? `<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${progress}%"></div></div>` : ''}
      ${isExpanded && t.description ? `<div class="task-desc">${escHtml(t.description)}</div>` : ''}
      ${subsHtml}
    </div>
  `;
}

function updateStatus(count, minutes) {
  const timeStr = minutes > 0 ? ` | 예상 ${formatMinutes(minutes)}` : '';
  $('#status-info').textContent = `남은 작업 ${count}개${timeStr}`;
}

// ── Events ──

function bindEvents() {
  document.addEventListener('click', async (e) => {
    // Sidebar nav
    const sideItem = e.target.closest('.sidebar-item[data-view]');
    if (sideItem) {
      const view = sideItem.dataset.view;
      $$('.sidebar-item').forEach(el => el.classList.remove('active'));
      sideItem.classList.add('active');

      if (view === 'project') {
        currentView = 'project';
        currentProjectId = Number(sideItem.dataset.projectId);
      } else if (view === 'all') {
        currentView = 'date';
      } else if (view === 'calendar') {
        currentView = 'calendar';
      } else {
        currentView = 'today';
      }
      await loadTasks();
      return;
    }

    // Delete project
    const delProj = e.target.closest('.btn-delete-project');
    if (delProj) {
      e.stopPropagation();
      const id = Number(delProj.dataset.id);
      await window.orbit.deleteProject(id);
      await loadProjects();
      if (currentView === 'project' && currentProjectId === id) {
        currentView = 'today';
        await loadTasks();
      }
      return;
    }

    // Expand/collapse subtasks
    const expandBtn = e.target.closest('.btn-expand');
    if (expandBtn) {
      const id = Number(expandBtn.dataset.id);
      if (expandedTasks.has(id)) expandedTasks.delete(id);
      else expandedTasks.add(id);
      await loadTasks();
      return;
    }

    // Add subtask button (expand + focus input)
    const addSubBtn = e.target.closest('.btn-add-sub');
    if (addSubBtn) {
      const id = Number(addSubBtn.dataset.id);
      expandedTasks.add(id);
      await loadTasks();
      setTimeout(() => {
        const input = document.querySelector(`.subtask-input[data-parent="${id}"]`);
        if (input) input.focus();
      }, 50);
      return;
    }

    // Check/uncheck task
    const check = e.target.closest('.task-check');
    if (check) {
      const id = Number(check.dataset.id);
      const isDone = check.classList.contains('checked');
      const newStatus = isDone ? 'pending' : 'done';

      const isSub = check.classList.contains('sub-check');
      if (newStatus === 'done' && !isSub) {
        const card = check.closest('.task-card');
        if (card && card.dataset.hasSubs === '1') {
          const ok = await showConfirmDialog('서브태스크가 포함된 작업입니다.\n완료 목록에 추가하시겠습니까?');
          if (!ok) return;
        }
        await completeTaskWithStopwatch(id, check.closest('.task-card'));
        showUndoToast(id);
      } else if (newStatus === 'done' && isSub) {
        const subItem = check.closest('.subtask-item');
        await completeTaskWithStopwatch(id, subItem);
      } else {
        await window.orbit.updateTask(id, { status: newStatus });
      }
      return;
    }

    // Delete task
    const delTask = e.target.closest('.btn-delete-task');
    if (delTask) {
      const id = Number(delTask.dataset.id);
      await window.orbit.deleteTask(id);
      return;
    }
  });

  // Subtask input (Enter to add)
  document.addEventListener('keydown', async (e) => {
    const input = e.target.closest('.subtask-input');
    if (input && e.key === 'Enter') {
      const title = input.value.trim();
      if (!title) return;
      const parentId = Number(input.dataset.parent);
      await window.orbit.createTask({ parent_id: parentId, title });
      input.value = '';
    }

    // Inline edit: Enter to save, Escape to cancel
    const editInput = e.target.closest('.inline-edit-input');
    if (editInput) {
      if (e.key === 'Enter') {
        const id = Number(editInput.dataset.id);
        const newTitle = editInput.value.trim();
        if (newTitle) await window.orbit.updateTask(id, { title: newTitle });
        else await loadTasks();
      }
      if (e.key === 'Escape') await loadTasks();
    }
  });

  // Double-click subtask title to edit inline
  document.addEventListener('dblclick', (e) => {
    const titleEl = e.target.closest('.editable-title');
    if (!titleEl) return;
    const id = titleEl.dataset.id;
    const currentText = titleEl.textContent;
    titleEl.outerHTML = `<input type="text" class="inline-edit-input" data-id="${id}" value="${currentText}" />`;
    const input = document.querySelector(`.inline-edit-input[data-id="${id}"]`);
    if (input) { input.focus(); input.select(); }
  });

  // Inline edit: save on blur
  document.addEventListener('focusout', async (e) => {
    const editInput = e.target.closest('.inline-edit-input');
    if (editInput) {
      const id = Number(editInput.dataset.id);
      const newTitle = editInput.value.trim();
      if (newTitle) await window.orbit.updateTask(id, { title: newTitle });
      else await loadTasks();
    }
  });

  // Subtask estimate change
  document.addEventListener('change', async (e) => {
    const estInput = e.target.closest('.subtask-est-input');
    if (estInput) {
      const id = Number(estInput.dataset.id);
      const minutes = Number(estInput.value) || null;
      await window.orbit.updateTask(id, { estimate_minutes: minutes });
    }
  });

  // Add main task
  $('#btn-add-task').addEventListener('click', addTask);
  $('#new-task-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
  });

  // Date picker
  $('#date-picker').addEventListener('change', async (e) => {
    currentDate = e.target.value;
    currentView = 'date';
    $$('.sidebar-item').forEach(el => el.classList.remove('active'));
    await loadTasks();
  });

  // Project modal
  $('#btn-add-project').addEventListener('click', () => {
    $('#project-modal').classList.remove('hidden');
    $('#project-name').focus();
  });

  $('#btn-cancel-project').addEventListener('click', () => {
    $('#project-modal').classList.add('hidden');
    clearProjectModal();
  });

  $('#btn-confirm-project').addEventListener('click', async () => {
    const name = $('#project-name').value.trim();
    if (!name) return;
    await window.orbit.createProject({
      name,
      folder_path: $('#project-path').value.trim() || undefined,
      tech_stack: $('#project-tech').value.trim() || undefined,
    });
    $('#project-modal').classList.add('hidden');
    clearProjectModal();
    await loadProjects();
  });

  $('#project-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-confirm-project').click();
    if (e.key === 'Escape') $('#btn-cancel-project').click();
  });

  // Right-click context menu
  const ctxMenu = document.createElement('div');
  ctxMenu.id = 'main-ctx-menu';
  ctxMenu.className = 'main-ctx-menu hidden';
  document.body.appendChild(ctxMenu);

  document.addEventListener('contextmenu', (e) => {
    const subItem = e.target.closest('.subtask-item');
    const card = e.target.closest('.task-card');
    if (!card && !subItem) { ctxMenu.classList.add('hidden'); return; }
    e.preventDefault();

    let id, hasSubs, swStarted, swElapsed, swSource;
    if (subItem) {
      id = Number(subItem.dataset.id);
      hasSubs = false;
      swStarted = subItem.dataset.swStarted;
      swElapsed = Number(subItem.dataset.swElapsed) || 0;
      swSource = subItem;
    } else {
      id = Number(card.dataset.id);
      hasSubs = card.dataset.hasSubs === '1';
      swStarted = card.dataset.swStarted;
      swElapsed = Number(card.dataset.swElapsed) || 0;
      swSource = card;
    }

    const isRunning = !!swStarted;
    const isPaused = !isRunning && swElapsed > 0;

    let swItems = '';
    if (isRunning) {
      swItems = `
        <button class="mctx-item mctx-sw-pause" data-id="${id}">&#9208; 일시정지</button>
        <button class="mctx-item mctx-sw-stop" data-id="${id}">&#9209; 중지</button>
      `;
    } else if (isPaused) {
      swItems = `
        <button class="mctx-item mctx-sw-resume" data-id="${id}">&#9654; 스톱워치 재개</button>
        <button class="mctx-item mctx-sw-stop" data-id="${id}">&#9209; 중지</button>
      `;
    } else {
      swItems = `<button class="mctx-item mctx-sw-start" data-id="${id}">&#9201; 스톱워치 시작</button>`;
    }

    ctxMenu.innerHTML = `
      <button class="mctx-item mctx-focus" data-id="${id}">&#9654; 작업 시작</button>
      ${swItems}
      <div class="mctx-divider"></div>
      <button class="mctx-item mctx-complete" data-id="${id}">&#10003; 완료</button>
      <button class="mctx-item mctx-delete" data-id="${id}">&#10005; 삭제</button>
    `;
    ctxMenu.classList.remove('hidden');

    const x = Math.min(e.clientX, window.innerWidth - 160);
    const y = Math.min(e.clientY, window.innerHeight - 140);
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;

    ctxMenu.querySelector('.mctx-focus').addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (!isRunning) await window.orbit.updateTask(id, { stopwatch_started_at: nowLocal() });
    });

    ctxMenu.querySelector('.mctx-complete').addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (hasSubs) {
        const ok = await showConfirmDialog('서브태스크가 포함된 작업입니다.\n완료 목록에 추가하시겠습니까?');
        if (!ok) return;
      }
      if (subItem) {
        await completeTaskWithStopwatch(id, swSource);
      } else {
        await completeTaskWithStopwatch(id, swSource);
        showUndoToast(id);
      }
    });

    ctxMenu.querySelector('.mctx-delete').addEventListener('click', async () => {
      await window.orbit.deleteTask(id);
      ctxMenu.classList.add('hidden');
    });

    bindMainStopwatchCtx(ctxMenu, id, swSource);
  });

  document.addEventListener('click', () => {
    ctxMenu.classList.add('hidden');
  });
}

async function addTask() {
  const titleEl = $('#new-task-title');
  const title = titleEl.value.trim();
  if (!title) return;

  const data = {
    title,
    priority: $('#new-task-priority').value,
    estimate_minutes: Number($('#new-task-estimate').value) || undefined,
    target_date: currentView === 'date' ? currentDate : undefined,
  };

  if (currentView === 'project' && currentProjectId) {
    data.project_id = currentProjectId;
  }

  await window.orbit.createTask(data);
  titleEl.value = '';
  $('#new-task-estimate').value = '';
  $('#new-task-priority').value = 'normal';
  titleEl.focus();
}

function clearProjectModal() {
  $('#project-name').value = '';
  $('#project-path').value = '';
  $('#project-tech').value = '';
}

// ── Confirm Dialog ──

function showConfirmDialog(message) {
  return new Promise((resolve) => {
    let overlay = document.getElementById('confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirm-overlay';
      overlay.className = 'confirm-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg">${message.replace(/\n/g, '<br>')}</div>
        <div class="confirm-btns">
          <button class="confirm-cancel">취소</button>
          <button class="confirm-ok">확인</button>
        </div>
      </div>
    `;
    overlay.classList.add('show');
    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      overlay.classList.remove('show');
      resolve(true);
    });
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
      overlay.classList.remove('show');
      resolve(false);
    });
  });
}

// ── Undo Toast ──

let undoTimer = null;

function showUndoToast(taskId) {
  clearTimeout(undoTimer);
  let toast = document.getElementById('undo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'undo-toast';
    toast.className = 'undo-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `작업 완료! <button class="undo-btn" id="btn-undo">되돌리기</button>`;
  toast.classList.add('show');

  const undoBtn = document.getElementById('btn-undo');
  undoBtn.addEventListener('click', async () => {
    await window.orbit.updateTask(taskId, { status: 'pending' });
    toast.classList.remove('show');
    clearTimeout(undoTimer);
  });

  undoTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 5000);
}

// ── Calendar ──

let selectedCalDay = null;

async function renderCalendar() {
  const container = $('#calendar-view');
  const completed = await window.orbit.getCompletedByMonth(calendarYear, calendarMonth);

  const byDay = {};
  for (const t of completed) {
    const day = t.completed_at ? t.completed_at.slice(0, 10) : null;
    if (!day) continue;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(t);
  }

  const groupByDay = {};
  for (const [day, tasks] of Object.entries(byDay)) {
    const parents = tasks.filter(t => !t.parent_id);
    const children = tasks.filter(t => t.parent_id);
    const grouped = parents.map(p => ({
      ...p,
      subs: children.filter(c => c.parent_id === p.id)
    }));
    const orphanSubs = children.filter(c => !parents.some(p => p.id === c.parent_id));
    groupByDay[day] = [...grouped, ...orphanSubs.map(s => ({ ...s, subs: [] }))];
  }

  const firstDay = new Date(calendarYear, calendarMonth - 1, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  let html = `
    <div class="cal-nav">
      <button class="cal-nav-btn" id="cal-prev">&#9664;</button>
      <span class="cal-nav-title">${calendarYear}년 ${calendarMonth}월</span>
      <button class="cal-nav-btn" id="cal-next">&#9654;</button>
    </div>
    <div class="cal-grid">
      ${dayNames.map(d => `<div class="cal-header">${d}</div>`).join('')}
  `;

  for (let i = 0; i < startDow; i++) {
    html += '<div class="cal-cell cal-empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayItems = groupByDay[dateStr] || [];
    const isToday = dateStr === today;
    const hasWork = dayItems.length > 0;

    const tasksHtml = dayItems.slice(0, 3).map(t => {
      const hasSubs = t.subs && t.subs.length > 0;
      return `<div class="cal-task" title="${escHtml(t.title)}${hasSubs ? ' (+' + t.subs.length + ')' : ''}">${escHtml(t.title)}${hasSubs ? ' <span class="cal-task-count">+' + t.subs.length + '</span>' : ''}</div>`;
    }).join('');
    const moreHtml = dayItems.length > 3 ? `<div class="cal-more">+${dayItems.length - 3}</div>` : '';

    const isSelected = dateStr === selectedCalDay;
    html += `
      <div class="cal-cell${isToday ? ' cal-today' : ''}${hasWork ? ' cal-active' : ''}${isSelected ? ' cal-selected' : ''}" data-date="${dateStr}">
        <span class="cal-day">${d}</span>
        <div class="cal-tasks">${tasksHtml}${moreHtml}</div>
      </div>
    `;
  }

  html += '</div>';

  const totalCompleted = completed.length;
  const activeDays = Object.keys(byDay).length;
  html += `<div class="cal-summary">이번 달: 완료 ${totalCompleted}개 · 활동일 ${activeDays}일</div>`;

  // Detail panel for selected day
  if (selectedCalDay) {
    const dateStr = selectedCalDay;
    const dayItems = groupByDay[dateStr] || [];
    const dayLabel = dateStr.slice(5).replace('-', '/');

    let detailHtml = `<div class="cal-detail" data-date="${dateStr}">
      <div class="cal-detail-header">
        <span class="cal-detail-date">${dayLabel} 완료 기록</span>
        <button class="cal-detail-close" data-date="${dateStr}">&times;</button>
      </div>
      <div class="cal-detail-list">`;

    if (dayItems.length === 0) {
      detailHtml += '<div class="cal-detail-empty">기록 없음</div>';
    }

    for (const t of dayItems) {
      const timeInfo = [];
      if (t.estimate_minutes) timeInfo.push(`예상 ${formatMinutes(t.estimate_minutes)}`);
      if (t.actual_minutes) timeInfo.push(`실제 ${formatMinutes(t.actual_minutes)}`);

      detailHtml += `<div class="cal-detail-item">
        <span class="cal-detail-check">&#10003;</span>
        <span class="cal-detail-title">${escHtml(t.title)}</span>
        ${timeInfo.length ? `<span class="cal-detail-time">${timeInfo.join(' / ')}</span>` : ''}
        <button class="cal-detail-restore" data-id="${t.id}" title="할 일로 복원">&#8634;</button>
      </div>`;
      detailHtml += `<div class="cal-detail-memo" data-id="${t.id}">
        <span class="cal-memo-text ${t.description ? '' : 'placeholder'}" data-id="${t.id}">${t.description ? escHtml(t.description) : '메모 추가...'}</span>
      </div>`;
      if (t.subs && t.subs.length > 0) {
        for (const s of t.subs) {
          const sTimeInfo = [];
          if (s.estimate_minutes) sTimeInfo.push(`예상 ${formatMinutes(s.estimate_minutes)}`);
          if (s.actual_minutes) sTimeInfo.push(`실제 ${formatMinutes(s.actual_minutes)}`);

          detailHtml += `<div class="cal-detail-item cal-detail-sub">
            <span class="cal-detail-check sub">&#10003;</span>
            <span class="cal-detail-title">${escHtml(s.title)}</span>
            ${sTimeInfo.length ? `<span class="cal-detail-time">${sTimeInfo.join(' / ')}</span>` : ''}
          </div>`;
          if (s.description) {
            detailHtml += `<div class="cal-detail-desc cal-detail-sub-desc">${escHtml(s.description)}</div>`;
          }
        }
      }
    }

    detailHtml += `</div>
      <div class="cal-detail-add">
        <input type="text" class="cal-add-input" data-date="${dateStr}" placeholder="이 날의 작업 일지 추가..." />
      </div>
    </div>`;
    html += detailHtml;
  }

  container.innerHTML = html;

  document.getElementById('cal-prev').addEventListener('click', async () => {
    calendarMonth--;
    if (calendarMonth < 1) { calendarMonth = 12; calendarYear--; }
    $('#view-title').textContent = `${calendarYear}년 ${calendarMonth}월`;
    selectedCalDay = null;
    await renderCalendar();
  });

  document.getElementById('cal-next').addEventListener('click', async () => {
    calendarMonth++;
    if (calendarMonth > 12) { calendarMonth = 1; calendarYear++; }
    $('#view-title').textContent = `${calendarYear}년 ${calendarMonth}월`;
    selectedCalDay = null;
    await renderCalendar();
  });

  container.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', async () => {
      const date = cell.dataset.date;
      if (!date) return;
      selectedCalDay = (selectedCalDay === date) ? null : date;
      await renderCalendar();
    });
  });

  container.querySelectorAll('.cal-detail-close').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      selectedCalDay = null;
      await renderCalendar();
    });
  });

  container.querySelectorAll('.cal-detail-restore').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      await window.orbit.updateTask(id, { status: 'pending' });
      await renderCalendar();
    });
  });

  container.querySelectorAll('.cal-add-input').forEach(input => {
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const title = input.value.trim();
      if (!title) return;
      const date = input.dataset.date;
      await window.orbit.createTask({ title, target_date: date, status: 'done' });
      input.value = '';
      await renderCalendar();
    });
  });

  container.querySelectorAll('.cal-memo-text').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      const current = el.classList.contains('placeholder') ? '' : el.textContent;
      const memo = el.closest('.cal-detail-memo');
      memo.innerHTML = `<textarea class="cal-memo-input" data-id="${id}" rows="2">${escHtml(current)}</textarea>`;
      const ta = memo.querySelector('.cal-memo-input');
      ta.focus();
      ta.addEventListener('focusout', async () => {
        const val = ta.value.trim();
        await window.orbit.updateTask(Number(id), { description: val || null });
        await renderCalendar();
      });
      ta.addEventListener('keydown', async (ev) => {
        if (ev.key === 'Escape') await renderCalendar();
      });
    });
  });
}

// ── Stopwatch helpers ──

function calcElapsed(base, startedAt) {
  if (!startedAt) return base;
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return base + Math.max(0, diff);
}

function formatSec(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function nowLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function completeTaskWithStopwatch(id, cardEl) {
  const elapsed = Number(cardEl?.dataset?.swElapsed) || 0;
  const started = cardEl?.dataset?.swStarted;
  const totalSec = calcElapsed(elapsed, started);
  const actualMin = totalSec > 0 ? Math.ceil(totalSec / 60) : null;
  const fields = { status: 'done', stopwatch_elapsed: 0, stopwatch_started_at: null };
  if (actualMin) fields.actual_minutes = actualMin;
  await window.orbit.updateTask(id, fields);
}

function bindMainStopwatchCtx(menu, id, sourceEl) {
  const start = menu.querySelector('.mctx-sw-start');
  const pause = menu.querySelector('.mctx-sw-pause');
  const resume = menu.querySelector('.mctx-sw-resume');
  const stop = menu.querySelector('.mctx-sw-stop');

  if (start) start.addEventListener('click', async () => {
    menu.classList.add('hidden');
    await window.orbit.updateTask(id, { stopwatch_started_at: nowLocal() });
  });
  if (pause) pause.addEventListener('click', async () => {
    menu.classList.add('hidden');
    const elapsed = Number(sourceEl.dataset.swElapsed) || 0;
    const started = sourceEl.dataset.swStarted;
    const total = calcElapsed(elapsed, started);
    await window.orbit.updateTask(id, { stopwatch_elapsed: total, stopwatch_started_at: null });
  });
  if (resume) resume.addEventListener('click', async () => {
    menu.classList.add('hidden');
    await window.orbit.updateTask(id, { stopwatch_started_at: nowLocal() });
  });
  if (stop) stop.addEventListener('click', async () => {
    menu.classList.add('hidden');
    await window.orbit.updateTask(id, { stopwatch_elapsed: 0, stopwatch_started_at: null });
  });
}

setInterval(() => {
  document.querySelectorAll('.sw-display.running').forEach(el => {
    const elapsed = Number(el.dataset.swElapsed) || 0;
    const started = el.dataset.swStarted;
    if (started) el.textContent = formatSec(calcElapsed(elapsed, started));
  });
}, 1000);

// ── Helpers ──

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function priorityLabel(p) {
  return { must: '필수', normal: '보통', low: '낮음' }[p] || p;
}

function formatMinutes(m) {
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r > 0 ? `${h}시간 ${r}분` : `${h}시간`;
  }
  return `${m}분`;
}

init();
