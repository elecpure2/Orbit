import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentView = 'today';
let currentProjectId = null;
let currentDate = todayYmd();
const expandedTasks = new Set();

let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth() + 1;
let calendarPlannedCacheKey = '';
let calendarPlannedCacheData = {};
const NOTE_CATEGORIES = ['idea', 'memo', 'dev'];
let selectedNoteId = null;
let tiptapEditor = null;
let noteOriginal = null; // { title, content, category, pinned }
let activeProjectFilter = null; // { id, name } or null
let liveTodayKey = todayYmd();

// ── Init ──

async function init() {
  await loadProjects();
  await loadTasks();
  bindEvents();

  $('#date-picker').value = currentDate;

  window.orbit.onTasksChanged(() => {
    clearCalendarPlannedCache();
    loadTasks();
  });
  window.orbit.onNotesChanged(() => {
    if (currentView === 'notes') renderNotes(selectedNoteId);
  });
  window.orbit.onFocusNewTask(() => $('#new-task-title').focus());
}

// ── Projects ──

async function loadProjects() {
  const projects = await window.orbit.getProjects();
  const list = $('#project-list');
  list.innerHTML = '';

  projects.forEach(p => {
    const btn = document.createElement('button');
    const isFiltered = activeProjectFilter && activeProjectFilter.id === p.id;
    btn.className = `sidebar-item project-item${isFiltered ? ' active' : ''}`;
    btn.dataset.view = 'project';
    btn.dataset.projectId = p.id;
    btn.innerHTML = `
      <span><span class="sidebar-icon">${isFiltered ? '&#9670;' : '&#9671;'}</span> ${escHtml(p.name)}</span>
      <span class="btn-delete-project" data-id="${p.id}" title="삭제">&times;</span>
    `;
    list.appendChild(btn);
  });
}

// ── Tasks ──

async function loadTasks() {
  const taskList = $('#task-list');
  const calView = $('#calendar-view');
  const notesView = $('#notes-view');
  const addBar = document.querySelector('.add-task-bar');
  const headerActions = document.querySelector('.header-actions');
  updateHeaderDateButtons();

  if (currentView === 'calendar') {
    taskList.classList.add('hidden');
    calView.classList.remove('hidden');
    notesView.classList.add('hidden');
    addBar.classList.add('hidden');
    headerActions.classList.remove('hidden');
    $('#in-progress-section').classList.add('hidden');
    $('#view-title').textContent = `${calendarYear}년 ${calendarMonth}월`;
    renderFilterBadge();
    await renderCalendar();
    return;
  }

  if (currentView === 'notes') {
    taskList.classList.add('hidden');
    calView.classList.add('hidden');
    notesView.classList.remove('hidden');
    addBar.classList.add('hidden');
    headerActions.classList.add('hidden');
    $('#in-progress-section').classList.add('hidden');
    $('#view-title').textContent = '아이디어 / 메모';
    renderFilterBadge();
    await renderNotes();
    return;
  }

  taskList.classList.remove('hidden');
  calView.classList.add('hidden');
  notesView.classList.add('hidden');
  addBar.classList.remove('hidden');
  headerActions.classList.remove('hidden');

  const pid = activeProjectFilter ? activeProjectFilter.id : undefined;
  let tasks;

  if (currentView === 'today') {
    currentDate = todayYmd();
    syncDatePicker();
    tasks = await window.orbit.getTodayTasks(pid);
    $('#view-title').textContent = '오늘 할 일';
  } else if (currentView === 'project' && currentProjectId) {
    tasks = await window.orbit.getTasksByProject(currentProjectId);
    const projects = await window.orbit.getProjects();
    const proj = projects.find(p => p.id === currentProjectId);
    $('#view-title').textContent = proj ? proj.name : '프로젝트';
  } else {
    syncDatePicker();
    tasks = await window.orbit.getTasksByDate(currentDate, pid);
    $('#view-title').textContent = currentDate;
  }

  renderFilterBadge();
  renderTasks(tasks);
  renderInProgress(tasks);
}

function renderInProgress(tasks) {
  const section = $('#in-progress-section');
  if (!tasks) { section.classList.add('hidden'); return; }

  const running = [];
  for (const t of tasks) {
    if (t.stopwatch_started_at && t.status !== 'done') {
      running.push({
        ...t,
        _parentTitle: null,
        _isSub: false,
        _hasSubs: !!(t.subtasks && t.subtasks.length > 0),
      });
    }
    if (t.subtasks) {
      for (const s of t.subtasks) {
        if (s.stopwatch_started_at && s.status !== 'done') {
          running.push({
            ...s,
            _parentTitle: t.title,
            _isSub: true,
            _hasSubs: false,
          });
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
      <div class="ip-card" data-id="${t.id}" data-sw-elapsed="${elapsed}" data-sw-started="${started}" data-has-subs="${t._hasSubs ? '1' : ''}" data-is-sub="${t._isSub ? '1' : ''}">
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
      const hasSubs = card?.dataset?.hasSubs === '1';
      const isSub = card?.dataset?.isSub === '1';
      if (hasSubs && !isSub) {
        const ok = await showConfirmDialog('서브태스크가 포함된 작업입니다.\n완료 목록에 추가하시겠습니까?');
        if (!ok) return;
      }
      await completeTaskWithStopwatch(id, card);
      if (!isSub) showUndoToast(id);
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

  if (currentView === 'today') {
    const todayBucket = [];
    const overdueBuckets = new Map();

    for (const t of activeTasks) {
      const overdueDays = getOverdueDays(t.target_date);
      if (overdueDays <= 0) {
        todayBucket.push(t);
      } else {
        if (!overdueBuckets.has(overdueDays)) overdueBuckets.set(overdueDays, []);
        overdueBuckets.get(overdueDays).push(t);
      }
    }

    let html = '';
    if (todayBucket.length > 0) {
      html += todayBucket.map(t => renderTaskCard(t)).join('');
    }

    const overdueKeys = [...overdueBuckets.keys()].sort((a, b) => a - b);
    for (const days of overdueKeys) {
      html += `<div class="task-section-divider">-- ${days}일 전 --</div>`;
      html += overdueBuckets.get(days).map(t => renderTaskCard(t)).join('');
    }

    list.innerHTML = html || '<div class="empty-state">할 일이 없습니다</div>';
  } else {
    list.innerHTML = activeTasks.map(t => renderTaskCard(t)).join('');
  }

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

async function renderNotes(preferredId) {
  const container = $('#notes-view');
  const pid = activeProjectFilter ? activeProjectFilter.id : undefined;
  const notes = await window.orbit.getNotes(pid);

  if (preferredId !== undefined && preferredId !== null) {
    selectedNoteId = Number(preferredId);
  }

  if (!notes || notes.length === 0) {
    selectedNoteId = null;
    container.innerHTML = `
      <div class="notes-shell notes-shell-empty">
        <div class="notes-empty-card">
          <div class="notes-empty-title">아직 노트가 없습니다</div>
          <div class="notes-empty-sub">아이디어/메모를 저장해두면 나중에 작업 계획으로 바로 옮길 수 있어요.</div>
          <button class="btn-add-note" id="btn-note-new">+ 새 노트 만들기</button>
        </div>
      </div>
    `;
    return;
  }

  if (!selectedNoteId || !notes.some(n => n.id === selectedNoteId)) {
    selectedNoteId = notes[0].id;
  }

  const selected = notes.find(n => n.id === selectedNoteId) || notes[0];
  if (!selected) return;

  const listHtml = notes.map(n => {
    const isActive = n.id === selected.id;
    const preview = stripHtml(n.content || '').trim();
    return `
      <button class="note-list-item ${isActive ? 'active' : ''}" data-id="${n.id}" title="${escHtml(n.title || '제목 없음')}">
        <div class="note-list-top">
          <span class="note-list-title">${escHtml(n.title || '제목 없음')}</span>
          ${n.pinned ? '<span class="note-list-pin">&#128204;</span>' : ''}
        </div>
        <div class="note-list-meta">${noteCategoryLabel(n.category)} · ${formatDateTime(n.updated_at)}</div>
        <div class="note-list-preview">${escHtml(preview || '세부 내용이 없습니다.')}</div>
      </button>
    `;
  }).join('');

  const editorContent = migrateNoteContent(selected.content);

  container.innerHTML = `
    <div class="notes-shell">
      <aside class="notes-left">
        <div class="notes-left-header">
          <span>아이디어 / 메모</span>
          <button class="header-date-btn" id="btn-note-new" title="새 노트">&#43;</button>
        </div>
        <div class="notes-listbook">${listHtml}</div>
      </aside>
      <section class="notes-right">
        <div class="notes-right-head">
          <input type="text" id="note-editor-title" class="note-editor-title" value="${escHtml(selected.title || '')}" placeholder="노트 제목" />
          <select id="note-editor-category" class="note-editor-category">${noteCategoryOptions(selected.category)}</select>
          <label class="note-pin-wrap" title="상단 고정">
            <input type="checkbox" id="note-editor-pinned" class="note-pin-input" ${selected.pinned ? 'checked' : ''} />
            고정
          </label>
        </div>
        <div class="note-toolbar" id="note-toolbar">
          <button class="tb-btn" data-cmd="heading" data-level="1" title="큰 제목">H1</button>
          <button class="tb-btn" data-cmd="heading" data-level="2" title="중간 제목">H2</button>
          <button class="tb-btn" data-cmd="heading" data-level="3" title="작은 제목">H3</button>
          <span class="tb-sep"></span>
          <button class="tb-btn" data-cmd="bold" title="굵게"><b>B</b></button>
          <button class="tb-btn" data-cmd="italic" title="기울기"><i>I</i></button>
          <button class="tb-btn" data-cmd="underline" title="밑줄"><u>U</u></button>
          <button class="tb-btn" data-cmd="strike" title="취소선"><s>S</s></button>
          <span class="tb-sep"></span>
          <div class="tb-dropdown">
            <button class="tb-btn" data-cmd="highlight-toggle" title="하이라이트">🖍</button>
            <div class="tb-palette tb-palette-hl hidden" id="palette-hl">
              <button class="tb-color-btn" data-hl="#fde68a" style="background:#fde68a" title="노랑"></button>
              <button class="tb-color-btn" data-hl="#bbf7d0" style="background:#bbf7d0" title="초록"></button>
              <button class="tb-color-btn" data-hl="#bfdbfe" style="background:#bfdbfe" title="파랑"></button>
              <button class="tb-color-btn" data-hl="#fecaca" style="background:#fecaca" title="빨강"></button>
              <button class="tb-color-btn" data-hl="#e9d5ff" style="background:#e9d5ff" title="보라"></button>
              <button class="tb-color-btn tb-color-none" data-hl="" title="제거">✕</button>
            </div>
          </div>
          <div class="tb-dropdown">
            <button class="tb-btn" data-cmd="color-toggle" title="글자 색">A<span class="tb-color-indicator" id="tb-color-ind"></span></button>
            <div class="tb-palette tb-palette-color hidden" id="palette-color">
              <button class="tb-color-btn" data-color="#f5f2ee" style="background:#f5f2ee" title="기본"></button>
              <button class="tb-color-btn" data-color="#ef4444" style="background:#ef4444" title="빨강"></button>
              <button class="tb-color-btn" data-color="#f97316" style="background:#f97316" title="주황"></button>
              <button class="tb-color-btn" data-color="#eab308" style="background:#eab308" title="노랑"></button>
              <button class="tb-color-btn" data-color="#22c55e" style="background:#22c55e" title="초록"></button>
              <button class="tb-color-btn" data-color="#3b82f6" style="background:#3b82f6" title="파랑"></button>
              <button class="tb-color-btn" data-color="#a855f7" style="background:#a855f7" title="보라"></button>
            </div>
          </div>
          <span class="tb-sep"></span>
          <button class="tb-btn" data-cmd="blockquote" title="인용">"</button>
          <button class="tb-btn" data-cmd="code" title="인라인 코드">&lt;/&gt;</button>
          <button class="tb-btn" data-cmd="codeBlock" title="코드 블록">▤</button>
          <span class="tb-sep"></span>
          <button class="tb-btn" data-cmd="bulletList" title="목록">•</button>
          <button class="tb-btn" data-cmd="orderedList" title="번호 목록">1.</button>
          <button class="tb-btn" data-cmd="horizontalRule" title="구분선">―</button>
        </div>
        <div id="note-editor-tiptap" class="note-editor-tiptap"></div>
        <div class="notes-right-actions">
          <button class="btn-add-note btn-note-save-disabled" id="btn-note-save" disabled>저장</button>
          <button class="btn-cancel" id="btn-note-delete">삭제</button>
        </div>
        <div class="note-meta">수정: ${formatDateTime(selected.updated_at)} · 단축키: Ctrl+S 저장</div>
      </section>
    </div>
  `;

  noteOriginal = {
    title: selected.title || '',
    content: editorContent,
    category: selected.category || 'memo',
    pinned: selected.pinned ? 1 : 0,
  };

  initTiptapEditor(editorContent);
  bindNoteToolbar();
  bindNoteDirtyEvents();
}


function migrateNoteContent(raw) {
  if (!raw) return '';
  if (raw.trim().startsWith('<')) return raw;
  return raw.split('\n').map(line => `<p>${escHtml(line) || '<br>'}</p>`).join('');
}

function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || '';
}

function initTiptapEditor(content) {
  if (tiptapEditor) { tiptapEditor.destroy(); tiptapEditor = null; }

  const el = $('#note-editor-tiptap');
  if (!el) return;

  tiptapEditor = new Editor({
    element: el,
    extensions: [
      StarterKit,
      Underline,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
    ],
    content: content || '<p></p>',
    onUpdate: () => updateNoteDirty(),
  });
}

function bindNoteToolbar() {
  const toolbar = $('#note-toolbar');
  if (!toolbar) return;

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tb-btn');
    if (!btn || !tiptapEditor) return;
    const cmd = btn.dataset.cmd;
    if (!cmd) return;

    const chain = tiptapEditor.chain().focus();
    switch (cmd) {
      case 'heading':
        chain.toggleHeading({ level: Number(btn.dataset.level) }).run();
        break;
      case 'bold': chain.toggleBold().run(); break;
      case 'italic': chain.toggleItalic().run(); break;
      case 'underline': chain.toggleUnderline().run(); break;
      case 'strike': chain.toggleStrike().run(); break;
      case 'blockquote': chain.toggleBlockquote().run(); break;
      case 'code': chain.toggleCode().run(); break;
      case 'codeBlock': chain.toggleCodeBlock().run(); break;
      case 'bulletList': chain.toggleBulletList().run(); break;
      case 'orderedList': chain.toggleOrderedList().run(); break;
      case 'horizontalRule': chain.setHorizontalRule().run(); break;
      case 'highlight-toggle':
        $('#palette-hl')?.classList.toggle('hidden');
        $('#palette-color')?.classList.add('hidden');
        return;
      case 'color-toggle':
        $('#palette-color')?.classList.toggle('hidden');
        $('#palette-hl')?.classList.add('hidden');
        return;
    }
  });

  toolbar.addEventListener('click', (e) => {
    const hlBtn = e.target.closest('[data-hl]');
    if (hlBtn && tiptapEditor) {
      const color = hlBtn.dataset.hl;
      if (color) tiptapEditor.chain().focus().toggleHighlight({ color }).run();
      else tiptapEditor.chain().focus().unsetHighlight().run();
      $('#palette-hl')?.classList.add('hidden');
      return;
    }

    const colorBtn = e.target.closest('[data-color]');
    if (colorBtn && tiptapEditor) {
      const color = colorBtn.dataset.color;
      tiptapEditor.chain().focus().setColor(color).run();
      const ind = $('#tb-color-ind');
      if (ind) ind.style.background = color;
      $('#palette-color')?.classList.add('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tb-dropdown')) {
      $('#palette-hl')?.classList.add('hidden');
      $('#palette-color')?.classList.add('hidden');
    }
  });
}

function isNoteDirty() {
  if (!noteOriginal) return false;
  const titleEl = $('#note-editor-title');
  const categoryEl = $('#note-editor-category');
  const pinnedEl = $('#note-editor-pinned');
  if (!titleEl || !categoryEl || !pinnedEl) return false;

  const currentContent = tiptapEditor ? tiptapEditor.getHTML() : '';
  return (
    titleEl.value !== noteOriginal.title ||
    currentContent !== (noteOriginal.content || '') ||
    categoryEl.value !== noteOriginal.category ||
    (pinnedEl.checked ? 1 : 0) !== noteOriginal.pinned
  );
}

function updateNoteDirty() {
  const btn = $('#btn-note-save');
  if (!btn) return;
  const dirty = isNoteDirty();
  btn.disabled = !dirty;
  btn.classList.toggle('btn-note-save-disabled', !dirty);
}

function bindNoteDirtyEvents() {
  const titleEl = $('#note-editor-title');
  const categoryEl = $('#note-editor-category');
  const pinnedEl = $('#note-editor-pinned');
  if (!titleEl || !categoryEl || !pinnedEl) return;

  titleEl.addEventListener('input', updateNoteDirty);
  categoryEl.addEventListener('change', updateNoteDirty);
  pinnedEl.addEventListener('change', updateNoteDirty);
}

async function createNoteAndSelect() {
  const note = await window.orbit.createNote({
    title: '새 노트',
    content: null,
    category: 'memo',
    pinned: 0,
    project_id: activeProjectFilter ? activeProjectFilter.id : null,
  });
  selectedNoteId = note.id;
  await renderNotes(selectedNoteId);
  const titleEl = $('#note-editor-title');
  if (titleEl) {
    titleEl.focus();
    titleEl.select();
  }
}

function getNoteEditorData() {
  const titleEl = $('#note-editor-title');
  const categoryEl = $('#note-editor-category');
  const pinnedEl = $('#note-editor-pinned');
  if (!titleEl || !categoryEl || !pinnedEl) return null;

  const title = titleEl.value.trim();
  if (!title) {
    titleEl.focus();
    return null;
  }

  const content = tiptapEditor ? tiptapEditor.getHTML() : null;
  return {
    title,
    content: content || null,
    category: categoryEl.value || 'memo',
    pinned: pinnedEl.checked ? 1 : 0,
  };
}

async function saveSelectedNote() {
  if (!selectedNoteId) return;
  if (!isNoteDirty()) return;
  const fields = getNoteEditorData();
  if (!fields) return;
  await window.orbit.updateNote(selectedNoteId, fields);
  await renderNotes(selectedNoteId);
}

async function deleteSelectedNote() {
  if (!selectedNoteId) return;
  const ok = await showConfirmDialog('이 노트를 삭제할까요?');
  if (!ok) return;
  await window.orbit.deleteNote(selectedNoteId);
  selectedNoteId = null;
  await renderNotes();
}

function noteCategoryOptions(selected) {
  return NOTE_CATEGORIES.map(key => {
    const selectedAttr = key === (selected || 'memo') ? 'selected' : '';
    return `<option value="${key}" ${selectedAttr}>${noteCategoryLabel(key)}</option>`;
  }).join('');
}

function noteCategoryLabel(key) {
  return { idea: '아이디어', memo: '메모', dev: '개발메모' }[key] || key;
}

function updateStatus(count, minutes) {
  const timeStr = minutes > 0 ? ` | 예상 ${formatMinutes(minutes)}` : '';
  $('#status-info').textContent = `남은 작업 ${count}개${timeStr}`;
}

function clearCalendarPlannedCache() {
  calendarPlannedCacheKey = '';
  calendarPlannedCacheData = {};
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmdAsLocalDate(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function getOverdueDays(targetDate) {
  const due = parseYmdAsLocalDate(targetDate);
  if (!due) return 0;
  const now = parseYmdAsLocalDate(todayYmd());
  if (!now) return 0;
  const diff = Math.floor((now.getTime() - due.getTime()) / 86400000);
  return Math.max(0, diff);
}

function shiftDateYmd(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function syncDatePicker() {
  const picker = $('#date-picker');
  if (!picker) return;
  picker.value = currentDate;
}

function setSidebarActive(view) {
  $$('.sidebar-item').forEach(el => {
    if (!el.classList.contains('project-item')) el.classList.remove('active');
  });
  const target = document.querySelector(`.sidebar-item[data-view="${view}"]`);
  if (target) target.classList.add('active');
}

function renderFilterBadge() {
  let badge = $('#filter-badge');
  if (!activeProjectFilter) {
    if (badge) badge.remove();
    return;
  }
  const title = $('#view-title');
  if (!title) return;
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'filter-badge';
    badge.className = 'filter-badge';
    title.parentNode.insertBefore(badge, title.nextSibling);
  }
  badge.innerHTML = `\u25C6 ${escHtml(activeProjectFilter.name)} <button class="filter-badge-x" id="btn-clear-filter">\u2715</button>`;
}

function clearProjectFilter() {
  activeProjectFilter = null;
  loadProjects();
}

function updateHeaderDateButtons() {
  const prevBtn = $('#btn-date-prev');
  const nextBtn = $('#btn-date-next');
  if (!prevBtn || !nextBtn) return;

  const canNavigate = currentView !== 'project' && currentView !== 'notes';
  prevBtn.classList.toggle('hidden', !canNavigate);
  nextBtn.classList.toggle('hidden', !canNavigate);
}

async function moveHeaderDate(step) {
  if (currentView === 'project' || currentView === 'notes') return;

  if (currentView === 'calendar') {
    calendarMonth += step;
    if (calendarMonth < 1) {
      calendarMonth = 12;
      calendarYear--;
    } else if (calendarMonth > 12) {
      calendarMonth = 1;
      calendarYear++;
    }
    selectedCalDay = null;
    await loadTasks();
    return;
  }

  const baseDate = currentView === 'today' ? todayYmd() : currentDate;
  currentDate = shiftDateYmd(baseDate, step);
  currentView = 'date';
  setSidebarActive('all');
  await loadTasks();
}

// ── Events ──

function bindEvents() {
  document.addEventListener('click', async (e) => {
    // Filter badge clear
    if (e.target.closest('#btn-clear-filter')) {
      clearProjectFilter();
      clearCalendarPlannedCache();
      await loadTasks();
      return;
    }

    // Sidebar nav
    const sideItem = e.target.closest('.sidebar-item[data-view]');
    if (sideItem) {
      const view = sideItem.dataset.view;

      // Project click = filter toggle (keep current view)
      if (view === 'project') {
        const projId = Number(sideItem.dataset.projectId);
        if (activeProjectFilter && activeProjectFilter.id === projId) {
          clearProjectFilter();
        } else {
          const projects = await window.orbit.getProjects();
          const proj = projects.find(p => p.id === projId);
          activeProjectFilter = proj ? { id: proj.id, name: proj.name } : null;
          loadProjects();
        }
        clearCalendarPlannedCache();
        await loadTasks();
        return;
      }

      // Tab click = view change
      $$('.sidebar-item').forEach(el => {
        if (!el.classList.contains('project-item')) el.classList.remove('active');
      });
      sideItem.classList.add('active');

      if (view === 'all') {
        currentView = 'date';
      } else if (view === 'calendar') {
        currentView = 'calendar';
      } else if (view === 'notes') {
        currentView = 'notes';
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

    const noteListItem = e.target.closest('.note-list-item');
    if (noteListItem) {
      selectedNoteId = Number(noteListItem.dataset.id);
      await renderNotes(selectedNoteId);
      return;
    }

    const noteNewBtn = e.target.closest('#btn-note-new');
    if (noteNewBtn) {
      await createNoteAndSelect();
      return;
    }

    const noteSaveBtn = e.target.closest('#btn-note-save');
    if (noteSaveBtn) {
      await saveSelectedNote();
      return;
    }

    const noteDeleteBtn = e.target.closest('#btn-note-delete');
    if (noteDeleteBtn) {
      await deleteSelectedNote();
      return;
    }
  });

  // Subtask input (Enter to add)
  document.addEventListener('keydown', async (e) => {
    if (currentView === 'notes' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      await saveSelectedNote();
      return;
    }

    if (e.target.id === 'note-editor-title' && e.key === 'Enter') {
      e.preventDefault();
      await saveSelectedNote();
      return;
    }

    if (e.target.id === 'note-editor-content' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      await saveSelectedNote();
      return;
    }

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

    // TipTap handles its own focus events
  });

  // Subtask estimate change
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'note-editor-title') {
      updateNoteDirty();
      return;
    }

    if (e.target.id === 'note-editor-category') {
      updateNoteDirty();
      return;
    }

    if (e.target.id === 'note-editor-pinned') {
      updateNoteDirty();
      return;
    }

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
    setSidebarActive('all');
    await loadTasks();
  });

  $('#btn-date-prev').addEventListener('click', async () => {
    await moveHeaderDate(-1);
  });

  $('#btn-date-next').addEventListener('click', async () => {
    await moveHeaderDate(1);
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
      if (!isRunning) await startTaskTimer(id);
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

function monthDateStrings(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${year}-${mm}-${String(d).padStart(2, '0')}`);
  }
  return dates;
}

async function getPlannedByDayForMonth(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  if (calendarPlannedCacheKey === key) return calendarPlannedCacheData;

  const dates = monthDateStrings(year, month);
  const pid = activeProjectFilter ? activeProjectFilter.id : undefined;
  const results = await Promise.all(dates.map(async (dateStr) => {
    const dayTasks = await window.orbit.getTasksByDate(dateStr, pid);
    return [dateStr, (dayTasks || []).filter(t => t.status === 'pending')];
  }));

  const byDay = {};
  for (const [dateStr, tasks] of results) {
    byDay[dateStr] = tasks;
  }

  calendarPlannedCacheKey = key;
  calendarPlannedCacheData = byDay;
  return byDay;
}

async function renderCalendar() {
  const container = $('#calendar-view');
  const pid = activeProjectFilter ? activeProjectFilter.id : undefined;
  const [completed, plannedByDay] = await Promise.all([
    window.orbit.getCompletedByMonth(calendarYear, calendarMonth, pid),
    getPlannedByDayForMonth(calendarYear, calendarMonth),
  ]);

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
  const today = todayYmd();

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
    const doneItems = groupByDay[dateStr] || [];
    const plannedItems = plannedByDay[dateStr] || [];
    const previewItems = [
      ...doneItems.map(t => ({
        kind: 'done',
        title: t.title,
        subCount: (t.subs && t.subs.length) || 0,
      })),
      ...plannedItems.map(t => ({
        kind: 'plan',
        title: t.title,
        subCount: (t.subtasks && t.subtasks.length) || 0,
      })),
    ];
    const isToday = dateStr === today;
    const hasWork = previewItems.length > 0;

    const tasksHtml = previewItems.slice(0, 3).map(item => {
      const hasSubs = item.subCount > 0;
      const badgeLabel = item.kind === 'done' ? '완료' : '예정';
      return `<div class="cal-task ${item.kind}" title="[${badgeLabel}] ${escHtml(item.title)}${hasSubs ? ' (+' + item.subCount + ')' : ''}">${escHtml(item.title)}${hasSubs ? ' <span class="cal-task-count">+' + item.subCount + '</span>' : ''}</div>`;
    }).join('');
    const moreHtml = previewItems.length > 3 ? `<div class="cal-more">+${previewItems.length - 3}</div>` : '';

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
  const totalPlanned = Object.values(plannedByDay).reduce((acc, items) => acc + items.length, 0);
  const plannedDays = Object.values(plannedByDay).filter(items => items.length > 0).length;
  html += `<div class="cal-summary">이번 달: 완료 ${totalCompleted}개 · 예정 ${totalPlanned}개 · 완료일 ${activeDays}일 · 예정일 ${plannedDays}일</div>`;

  // Detail panel for selected day
  if (selectedCalDay) {
    const dateStr = selectedCalDay;
    const dayDoneItems = groupByDay[dateStr] || [];
    const dayPlannedItems = plannedByDay[dateStr] || [];
    const dayLabel = dateStr.slice(5).replace('-', '/');

    let detailHtml = `<div class="cal-detail" data-date="${dateStr}">
      <div class="cal-detail-header">
        <span class="cal-detail-date">${dayLabel} 작업 보기</span>
        <button class="cal-detail-close" data-date="${dateStr}">&times;</button>
      </div>
      <div class="cal-detail-list">`;

    if (dayDoneItems.length === 0 && dayPlannedItems.length === 0) {
      detailHtml += '<div class="cal-detail-empty">기록 없음</div>';
    }

    if (dayDoneItems.length > 0) {
      detailHtml += '<div class="cal-detail-section-title">완료</div>';
      for (const t of dayDoneItems) {
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
    }

    if (dayPlannedItems.length > 0) {
      detailHtml += '<div class="cal-detail-section-title">예정 / 할 일</div>';
      for (const t of dayPlannedItems) {
        const timeInfo = [];
        if (t.estimate_minutes) timeInfo.push(`예상 ${formatMinutes(t.estimate_minutes)}`);
        if (t.subtasks && t.subtasks.length > 0) timeInfo.push(`서브 ${t.subtasks.length}개`);

        detailHtml += `<div class="cal-detail-item">
          <span class="cal-detail-check plan">&#9711;</span>
          <span class="cal-detail-title">${escHtml(t.title)}</span>
          ${timeInfo.length ? `<span class="cal-detail-time">${timeInfo.join(' / ')}</span>` : ''}
        </div>`;
        if (t.description) {
          detailHtml += `<div class="cal-detail-desc">${escHtml(t.description)}</div>`;
        }
      }
    }

    detailHtml += `</div>
      <div class="cal-detail-add">
        <input type="text" class="cal-add-input" data-date="${dateStr}" placeholder="이 날의 완료 작업 일지 추가..." />
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
      clearCalendarPlannedCache();
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
      clearCalendarPlannedCache();
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
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function nowLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

let uiAudioCtx = null;
function playUiSfx(type = 'start') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!uiAudioCtx) uiAudioCtx = new AudioCtx();
    if (uiAudioCtx.state === 'suspended') uiAudioCtx.resume();

    const osc = uiAudioCtx.createOscillator();
    const gain = uiAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(uiAudioCtx.destination);

    const now = uiAudioCtx.currentTime;
    if (type === 'complete') {
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.stop(now + 0.15);
    } else {
      osc.frequency.setValueAtTime(560, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.06);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.04, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      osc.stop(now + 0.1);
    }
    osc.start(now);
  } catch (_e) {
    // ignore audio failures silently
  }
}

async function startTaskTimer(id) {
  await window.orbit.updateTask(id, { stopwatch_started_at: nowLocal() });
  playUiSfx('start');
}

async function completeTaskWithStopwatch(id, cardEl) {
  const elapsed = Number(cardEl?.dataset?.swElapsed) || 0;
  const started = cardEl?.dataset?.swStarted;
  const totalSec = calcElapsed(elapsed, started);
  const actualMin = totalSec > 0 ? Math.ceil(totalSec / 60) : null;
  const fields = { status: 'done', stopwatch_elapsed: 0, stopwatch_started_at: null };
  if (actualMin) fields.actual_minutes = actualMin;
  await window.orbit.updateTask(id, fields);
  playUiSfx('complete');
}

function bindMainStopwatchCtx(menu, id, sourceEl) {
  const start = menu.querySelector('.mctx-sw-start');
  const pause = menu.querySelector('.mctx-sw-pause');
  const resume = menu.querySelector('.mctx-sw-resume');
  const stop = menu.querySelector('.mctx-sw-stop');

  if (start) start.addEventListener('click', async () => {
    menu.classList.add('hidden');
    await startTaskTimer(id);
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
    await startTaskTimer(id);
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

setInterval(() => {
  const nowKey = todayYmd();
  if (nowKey === liveTodayKey) return;
  liveTodayKey = nowKey;
  clearCalendarPlannedCache();

  if (currentView === 'today') {
    currentDate = nowKey;
    syncDatePicker();
    loadTasks();
  }
}, 30000);

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

function formatDateTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
}

init();
