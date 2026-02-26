const $ = (sel) => document.querySelector(sel);

let collapsed = false;
const expandedSticker = new Set();
let focusTaskId = null;

async function init() {
  await loadTasks();
  bindEvents();

  window.orbit.onTasksChanged(() => loadTasks());
}

async function loadTasks() {
  const tasks = await window.orbit.getTodayTasks();

  if (focusTaskId) {
    const found = findTaskById(tasks, focusTaskId);
    if (found && found.status !== 'done') {
      renderFocusMode(found);
      return;
    }
    focusTaskId = null;
  }

  renderTasks(tasks);
}

function findTaskById(tasks, id) {
  for (const t of (tasks || [])) {
    if (t.id === id) return t;
    if (t.subtasks) {
      const sub = t.subtasks.find(s => s.id === id);
      if (sub) return { ...sub, _parentTitle: t.title };
    }
  }
  return null;
}

function renderFocusMode(task) {
  const list = $('#task-list');
  const footer = $('#sticker-footer');

  const elapsed = task.stopwatch_elapsed || 0;
  const started = task.stopwatch_started_at || '';
  const isRunning = !!started;
  const isPaused = !isRunning && elapsed > 0;
  const timeStr = formatSec(calcElapsed(elapsed, started));
  const swClass = isRunning ? 'running' : (isPaused ? 'paused' : '');

  const parentLabel = task._parentTitle ? `<div class="focus-parent">${escHtml(task._parentTitle)}</div>` : '';

  list.innerHTML = `
    <div class="focus-view" data-focus-id="${task.id}" data-sw-elapsed="${elapsed}" data-sw-started="${started}">
      ${parentLabel}
      <div class="focus-title">${escHtml(task.title)}</div>
      ${task.description ? `<div class="focus-desc">${escHtml(task.description)}</div>` : ''}
      <div class="focus-timer ${swClass}" data-sw-elapsed="${elapsed}" data-sw-started="${started}">${timeStr}</div>
      <div class="focus-controls">
        ${isRunning ? `
          <button class="focus-btn focus-pause" data-id="${task.id}">⏸ 일시정지</button>
        ` : `
          <button class="focus-btn focus-resume" data-id="${task.id}">▶ ${isPaused ? '재개' : '시작'}</button>
        `}
        <button class="focus-btn focus-complete" data-id="${task.id}">✓ 완료</button>
      </div>
      <button class="focus-back">← 목록으로</button>
    </div>
  `;

  footer.textContent = isRunning ? '작업 진행 중...' : (isPaused ? '일시정지' : '');
}

function renderTasks(tasks) {
  const list = $('#task-list');
  const footer = $('#sticker-footer');

  if (!tasks || tasks.length === 0) {
    list.innerHTML = '<div class="sticker-empty">오늘 할 일 없음</div>';
    footer.textContent = '';
    return;
  }

  const active = tasks.filter(t => t.status !== 'done');

  list.innerHTML = active.map(t => {
    const hasSubs = t.subtasks && t.subtasks.length > 0;
    const isOpen = expandedSticker.has(t.id);
    const doneCount = hasSubs ? t.subtasks.filter(s => s.status === 'done').length : 0;

    let subsHtml = '';
    if (hasSubs && isOpen) {
      subsHtml = t.subtasks.map(s => {
        const subSwHtml = stopwatchHtml(s);
        const doneTime = (s.status === 'done' && s.actual_minutes) ? `<span class="sticker-actual-time">⏱ ${formatMin(s.actual_minutes)}</span>` : '';
        return `
        <div class="sticker-sub ${s.status === 'done' ? 'done' : ''}" data-sub-id="${s.id}" data-sw-elapsed="${s.stopwatch_elapsed || 0}" data-sw-started="${s.stopwatch_started_at || ''}" data-tooltip="${escAttr(s.title)}${s.description ? '\n\n' + escAttr(s.description) : ''}">
          <button class="sticker-check sub ${s.status === 'done' ? 'checked' : ''}" data-id="${s.id}">&#10003;</button>
          <span class="sticker-sub-text">${escHtml(s.title)}</span>
          ${subSwHtml}
          ${doneTime}
          ${s.estimate_minutes ? `<span class="sticker-sub-time">${formatMin(s.estimate_minutes)}</span>` : ''}
        </div>
      `}).join('');
    }

    const swHtml = stopwatchHtml(t, true);

    return `
      <div class="sticker-task" data-has-subs="${hasSubs ? '1' : ''}" data-task-id="${t.id}" data-sw-elapsed="${t.stopwatch_elapsed || 0}" data-sw-started="${t.stopwatch_started_at || ''}">
        <button class="sticker-check" data-id="${t.id}">&#10003;</button>
        ${hasSubs ? `<button class="sticker-expand" data-id="${t.id}">${isOpen ? '&#9660;' : '&#9654;'}</button>` : ''}
        <span class="sticker-task-text" data-tooltip="${escAttr(t.title)}${t.description ? '\n\n' + escAttr(t.description) : ''}">${escHtml(t.title)}</span>
        ${swHtml}
        ${hasSubs ? `<span class="sticker-progress">${doneCount}/${t.subtasks.length}</span>` : ''}
        <span class="sticker-task-priority priority-${t.priority}"></span>
      </div>
      ${subsHtml}
    `;
  }).join('');

  let totalPending = 0;
  let totalMin = 0;
  active.forEach(t => {
    totalPending++;
    totalMin += (t.estimate_minutes || 0);
    if (t.subtasks) t.subtasks.filter(s => s.status !== 'done').forEach(s => {
      totalPending++;
      totalMin += (s.estimate_minutes || 0);
    });
  });

  footer.textContent = totalMin > 0
    ? `${totalPending}개 남음 | ${formatMin(totalMin)}`
    : `${totalPending}개 남음`;
}

function bindEvents() {
  document.addEventListener('click', async (e) => {
    // Focus mode buttons
    const focusBack = e.target.closest('.focus-back');
    if (focusBack) { focusTaskId = null; await loadTasks(); return; }

    const focusPause = e.target.closest('.focus-pause');
    if (focusPause) {
      const id = Number(focusPause.dataset.id);
      const view = focusPause.closest('.focus-view');
      await swPause(id, view);
      return;
    }
    const focusResume = e.target.closest('.focus-resume');
    if (focusResume) {
      const id = Number(focusResume.dataset.id);
      await swStart(id);
      return;
    }
    const focusComplete = e.target.closest('.focus-complete');
    if (focusComplete) {
      const id = Number(focusComplete.dataset.id);
      const view = focusComplete.closest('.focus-view');
      await completeTaskWithStopwatch(id, view);
      focusTaskId = null;
      return;
    }

    const expand = e.target.closest('.sticker-expand');
    if (expand) {
      const id = Number(expand.dataset.id);
      if (expandedSticker.has(id)) expandedSticker.delete(id);
      else expandedSticker.add(id);
      await loadTasks();
      return;
    }

    const check = e.target.closest('.sticker-check');
    if (check) {
      const id = Number(check.dataset.id);
      const isDone = check.classList.contains('checked');
      const newStatus = isDone ? 'pending' : 'done';

      const isSub = check.classList.contains('sub');
      if (newStatus === 'done' && !isSub) {
        const parentTask = check.closest('.sticker-task');
        if (parentTask && parentTask.dataset.hasSubs === '1') {
          const ok = await showConfirmDialog('서브태스크가 포함된 작업입니다.\n완료 목록에 추가하시겠습니까?');
          if (!ok) return;
        }
        await completeTaskWithStopwatch(id, parentTask);
        showStickerUndo(id);
      } else if (newStatus === 'done' && isSub) {
        const subEl = check.closest('.sticker-sub');
        await completeTaskWithStopwatch(id, subEl);
      } else {
        await window.orbit.updateTask(id, { status: newStatus });
      }
    }
  });

  $('#btn-collapse').addEventListener('click', () => {
    collapsed = !collapsed;
    $('#sticker-body').classList.toggle('collapsed', collapsed);
    $('#btn-collapse').innerHTML = collapsed ? '&#9776;' : '&#9866;';
  });

  $('#btn-open-main').addEventListener('click', () => {
    window.orbit.showMain();
  });

  $('#btn-pin').addEventListener('click', async () => {
    const pinned = await window.orbit.togglePin();
    $('#btn-pin').classList.toggle('pin-active', pinned);
    $('#btn-pin').title = pinned ? '항상 위에 고정 (켜짐)' : '항상 위에 고정 (꺼짐)';
  });

  // Right-click context menu
  const ctxMenu = document.createElement('div');
  ctxMenu.id = 'ctx-menu';
  ctxMenu.className = 'ctx-menu hidden';
  document.body.appendChild(ctxMenu);

  document.addEventListener('contextmenu', (e) => {
    const taskEl = e.target.closest('.sticker-task');
    const subEl = e.target.closest('.sticker-sub');
    const target = subEl || taskEl;
    if (!target) { ctxMenu.classList.add('hidden'); return; }

    clearTimeout(tooltipTimer);
    tooltip.classList.add('hidden');

    e.preventDefault();

    const checkBtn = target.querySelector('.sticker-check');
    if (!checkBtn) return;
    const id = Number(checkBtn.dataset.id);
    const isParentWithSubs = !subEl && taskEl && taskEl.dataset.hasSubs === '1';
    const swSource = subEl || taskEl || target;
    const swStarted = swSource.dataset.swStarted;
    const swElapsed = Number(swSource.dataset.swElapsed) || 0;
    const isRunning = !!swStarted;
    const isPaused = !isRunning && swElapsed > 0;

    let swItems = '';
    if (isRunning) {
      swItems = `
        <button class="ctx-item ctx-sw-pause" data-id="${id}">&#9208; 일시정지</button>
        <button class="ctx-item ctx-sw-stop" data-id="${id}">&#9209; 중지</button>
      `;
    } else if (isPaused) {
      swItems = `
        <button class="ctx-item ctx-sw-resume" data-id="${id}">&#9654; 스톱워치 재개</button>
        <button class="ctx-item ctx-sw-stop" data-id="${id}">&#9209; 중지</button>
      `;
    } else {
      swItems = `<button class="ctx-item ctx-sw-start" data-id="${id}">&#9201; 스톱워치 시작</button>`;
    }

    ctxMenu.innerHTML = `
      <button class="ctx-item ctx-focus" data-id="${id}">&#9654; 작업 시작</button>
      ${swItems}
      <div class="ctx-divider"></div>
      <button class="ctx-item ctx-complete" data-id="${id}">&#10003; 완료</button>
      <button class="ctx-item ctx-delete" data-id="${id}">&#10005; 삭제</button>
    `;
    ctxMenu.classList.remove('hidden');

    const x = Math.min(e.clientX, window.innerWidth - 130);
    const y = Math.min(e.clientY, window.innerHeight - 120);
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;

    ctxMenu.querySelector('.ctx-complete').addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (isParentWithSubs) {
        const ok = await showConfirmDialog('서브태스크가 포함된 작업입니다.\n완료 목록에 추가하시겠습니까?');
        if (!ok) return;
      }
      if (subEl) {
        await completeTaskWithStopwatch(id, swSource);
      } else {
        await completeTaskWithStopwatch(id, swSource);
        showStickerUndo(id);
      }
    });

    ctxMenu.querySelector('.ctx-delete').addEventListener('click', async () => {
      await window.orbit.deleteTask(id);
      ctxMenu.classList.add('hidden');
    });

    ctxMenu.querySelector('.ctx-focus').addEventListener('click', async () => {
      ctxMenu.classList.add('hidden');
      if (!isRunning) await swStart(id);
      focusTaskId = id;
      await loadTasks();
    });

    bindStopwatchCtx(ctxMenu, id, swSource);
  });

  document.addEventListener('click', () => {
    ctxMenu.classList.add('hidden');
  });

  // Tooltip on hover
  let tooltipTimer = null;
  const tooltip = document.createElement('div');
  tooltip.className = 'sticker-tooltip hidden';
  document.body.appendChild(tooltip);

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) return;
    if (focusTaskId) return;
    if (!ctxMenu.classList.contains('hidden')) return;
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
      tooltip.textContent = el.dataset.tooltip;
      tooltip.classList.remove('hidden');
      const rect = el.getBoundingClientRect();
      tooltip.style.left = `${Math.min(rect.left, 160)}px`;
      tooltip.style.top = `${rect.bottom + 6}px`;
    }, 400);
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (el) {
      clearTimeout(tooltipTimer);
      tooltip.classList.add('hidden');
    }
  });
}

function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const sticker = document.getElementById('sticker');
    let overlay = document.getElementById('confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirm-overlay';
      overlay.className = 'confirm-overlay';
      sticker.appendChild(overlay);
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

let stickerUndoTimer = null;
function showStickerUndo(taskId) {
  clearTimeout(stickerUndoTimer);
  let toast = document.getElementById('sticker-undo');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sticker-undo';
    toast.className = 'sticker-undo';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `완료! <button class="sticker-undo-btn" id="btn-sticker-undo">되돌리기</button>`;
  toast.classList.add('show');
  document.getElementById('btn-sticker-undo').addEventListener('click', async () => {
    await window.orbit.updateTask(taskId, { status: 'pending' });
    toast.classList.remove('show');
    clearTimeout(stickerUndoTimer);
  });
  stickerUndoTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

// ── Stopwatch helpers ──

function stopwatchHtml(task, compact) {
  const elapsed = task.stopwatch_elapsed || 0;
  const started = task.stopwatch_started_at || '';
  if (!elapsed && !started) return '';
  const cls = started ? 'running' : 'paused';
  return `<span class="sw-display ${cls}" data-sw-elapsed="${elapsed}" data-sw-started="${started}">${formatSec(calcElapsed(elapsed, started))}</span>`;
}

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

async function swStart(id) {
  await window.orbit.updateTask(id, { stopwatch_started_at: nowLocal() });
}

async function swPause(id, taskRow) {
  const elapsed = Number(taskRow?.dataset?.swElapsed) || 0;
  const started = taskRow?.dataset?.swStarted;
  const total = calcElapsed(elapsed, started);
  await window.orbit.updateTask(id, { stopwatch_elapsed: total, stopwatch_started_at: null });
}

async function swStop(id) {
  await window.orbit.updateTask(id, { stopwatch_elapsed: 0, stopwatch_started_at: null });
}

async function completeTaskWithStopwatch(id, taskRow) {
  const elapsed = Number(taskRow?.dataset?.swElapsed) || 0;
  const started = taskRow?.dataset?.swStarted;
  const totalSec = calcElapsed(elapsed, started);
  const actualMin = totalSec > 0 ? Math.ceil(totalSec / 60) : null;
  const fields = { status: 'done', stopwatch_elapsed: 0, stopwatch_started_at: null };
  if (actualMin) fields.actual_minutes = actualMin;
  await window.orbit.updateTask(id, fields);
}

function bindStopwatchCtx(menu, id, sourceEl) {
  const start = menu.querySelector('.ctx-sw-start');
  const pause = menu.querySelector('.ctx-sw-pause');
  const resume = menu.querySelector('.ctx-sw-resume');
  const stop = menu.querySelector('.ctx-sw-stop');

  if (start) start.addEventListener('click', async () => { menu.classList.add('hidden'); await swStart(id); });
  if (pause) pause.addEventListener('click', async () => {
    menu.classList.add('hidden');
    await swPause(id, sourceEl);
  });
  if (resume) resume.addEventListener('click', async () => { menu.classList.add('hidden'); await swStart(id); });
  if (stop) stop.addEventListener('click', async () => { menu.classList.add('hidden'); await swStop(id); });
}

setInterval(() => {
  document.querySelectorAll('.sw-display.running').forEach(el => {
    const elapsed = Number(el.dataset.swElapsed) || 0;
    const started = el.dataset.swStarted;
    if (started) el.textContent = formatSec(calcElapsed(elapsed, started));
  });
  const focusTimer = document.querySelector('.focus-timer.running');
  if (focusTimer) {
    const elapsed = Number(focusTimer.dataset.swElapsed) || 0;
    const started = focusTimer.dataset.swStarted;
    if (started) focusTimer.textContent = formatSec(calcElapsed(elapsed, started));
  }
}, 1000);

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatMin(m) {
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r > 0 ? `${h}h${r}m` : `${h}h`;
  }
  return `${m}m`;
}

init();
