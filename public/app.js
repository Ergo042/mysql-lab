const $ = selector => document.querySelector(selector);
const editor = $('#sqlEditor');
const snippets = {
  select: `-- 查看学生名单\nSELECT id, name, grade, joined_at\nFROM students\nORDER BY id;`,
  join: `-- 连接三张表，查看每位学生的选课成绩\nSELECT s.name AS 学生, c.name AS 课程, e.score AS 成绩\nFROM students AS s\nJOIN enrollments AS e ON e.student_id = s.id\nJOIN courses AS c ON c.id = e.course_id\nORDER BY e.score DESC;`,
  group: `-- 按课程统计选课人数与平均分\nSELECT c.name AS 课程, COUNT(e.student_id) AS 选课人数,\n       ROUND(AVG(e.score), 1) AS 平均分\nFROM courses AS c\nLEFT JOIN enrollments AS e ON e.course_id = c.id\nGROUP BY c.id, c.name\nORDER BY 平均分 DESC;`
};
let student = null;
let lastSets = [];
let toastTimer;
let databases = [];
let activeDatabase = null;
let currentView = 'workspace';
const isPhone = !!window.Android || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const defaultPreferences = { theme: 'system', accent: 'blue', fontSize: '14', resultDensity: 'comfortable', lineWrap: false, autoSave: true, showHints: true, reduceMotion: false };
let preferences = { ...defaultPreferences };
let challenges = [];
let selectedChallengeId = null;
let passedChallenges = new Set();
try { preferences = { ...preferences, ...JSON.parse(localStorage.getItem('mysql-lab-preferences') || '{}') }; } catch {}
function resolvedTheme() { return preferences.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preferences.theme; }
function applyPreferences() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = preferences.accent;
  document.documentElement.dataset.density = preferences.resultDensity;
  document.documentElement.dataset.wrap = preferences.lineWrap ? 'on' : 'off';
  document.documentElement.dataset.reduceMotion = preferences.reduceMotion ? 'on' : 'off';
  document.documentElement.style.setProperty('--editor-size', `${Number(preferences.fontSize) || 14}px`);
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101827' : '#f7f8fb';
  if (window.Android?.setThemeMode) window.Android.setThemeMode(preferences.theme);
  document.querySelectorAll('button[data-theme]').forEach(button => button.classList.toggle('selected', button.dataset.theme === preferences.theme));
  document.querySelectorAll('button[data-accent]').forEach(button => button.classList.toggle('selected', button.dataset.accent === preferences.accent));
  $('#fontSize').value = preferences.fontSize;
  $('#resultDensity').value = preferences.resultDensity;
  for (const key of ['lineWrap', 'autoSave', 'showHints', 'reduceMotion']) $(`#${key}`).checked = !!preferences[key];
}
function savePreferences() { try { localStorage.setItem('mysql-lab-preferences', JSON.stringify(preferences)); } catch {} applyPreferences(); }
applyPreferences();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (preferences.theme === 'system') applyPreferences(); });

async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options }); }
  catch { const error = new Error('无法连接本地服务'); error.hint = '检查应用是否仍在运行；返回上一页并重试启动，必要时到设置查看运行日志。'; throw error; }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`);
    error.code = data.code;
    error.hint = data.hint || (response.status === 401 ? '练习空间已失效，请重新打开应用。' : response.status >= 500 ? '本地服务遇到异常，请稍后重试；反复出现时查看运行日志。' : '检查输入后重试。');
    error.line = data.line;
    throw error;
  }
  return data;
}
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), message.length > 45 ? 6500 : 3500);
}
function toastError(action, error) { toast(`${action}：${error.message}${error.hint ? `。建议：${error.hint}` : ''}`); }
function syncLines() {
  const count = editor.value.split('\n').length;
  $('#lineNumbers').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
}
function setStudent(value) {
  student = value;
  $('#welcomeModal').hidden = !!value;
  $('#headerName').textContent = value?.name || '访客';
  $('#avatar').textContent = (value?.name || 'S').slice(0, 1).toUpperCase();
  if (value) {
    $('#profileName').value = value.name;
    try { activeDatabase = localStorage.getItem(`mysql-lab-database-${value.database}`) || value.database; }
    catch { activeDatabase = value.database; }
    refreshDatabases();
    loadChallenges();
  }
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('open');
}
function addText(parent, tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function showView(view) {
  currentView = view;
  $('#workspaceView').hidden = view !== 'workspace';
  $('#manageView').hidden = view !== 'manage';
  $('#challengeView').hidden = view !== 'challenges';
  $('#settingsView').hidden = view !== 'settings';
  $('#navWorkspace').classList.toggle('active', view === 'workspace');
  $('#navManage').classList.toggle('active', view === 'manage');
  $('#navChallenges').classList.toggle('active', view === 'challenges');
  $('#navSettings').classList.toggle('active', view === 'settings');
  $('#mobileWorkspace').classList.toggle('active', view === 'workspace');
  $('#mobileManage').classList.toggle('active', view === 'manage');
  $('#mobileChallenges').classList.toggle('active', view === 'challenges');
  $('#mobileSettings').classList.toggle('active', view === 'settings');
  const pages = { workspace: ['SQL 查询', 'SQL 工作台', '写下你的查询，探索数据背后的答案。'], manage: ['数据库管理', '数据库管理', '创建数据库、浏览数据表，整理你的练习空间。'], challenges: ['本地 Mini OJ', '闯关练习', '八道渐进练习，写 SQL、立即判题、从反馈中学会修正。'], settings: ['个性设置', '设置', '为这台设备调整外观、编辑体验与学习节奏。'] };
  const [crumb, heading, description] = pages[view] || pages.workspace;
  $('#breadcrumbCurrent').textContent = crumb;
  $('#pageHeading').textContent = heading;
  $('#pageDescription').textContent = description;
  $('.eyebrow').textContent = ({ workspace: 'YOUR WORKSPACE', manage: 'ORGANIZE YOUR DATA', challenges: 'SQL QUEST', settings: 'MAKE IT YOURS' })[view] || 'YOUR WORKSPACE';
  closeSidebar();
}
function databaseLabel(database) { return database?.isDefault ? '示例数据库' : database?.name || '数据库'; }
function renderDatabases() {
  const side = $('#databaseList');
  const cards = $('#databaseCards');
  side.textContent = '';
  cards.textContent = '';
  for (const database of databases) {
    const selected = database.databaseName === activeDatabase;
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = `database-choice${selected ? ' active' : ''}`;
    addText(choice, 'span', '▤', 'db-icon');
    addText(choice, 'span', databaseLabel(database), 'database-name');
    if (selected) addText(choice, 'span', '✓', 'database-check');
    choice.title = database.databaseName;
    choice.addEventListener('click', () => switchDatabase(database.databaseName));
    side.append(choice);

    const card = addText(cards, 'div', '', `database-card${selected ? ' active' : ''}`);
    const top = addText(card, 'div', '', 'database-card-top');
    addText(top, 'span', '▤', 'database-card-icon');
    const info = addText(top, 'div', '');
    addText(info, 'h3', databaseLabel(database));
    addText(info, 'p', database.databaseName);
    const actions = addText(card, 'div', '', 'database-card-actions');
    const switchButton = addText(actions, 'button', selected ? '当前使用' : '切换使用', 'small-action');
    switchButton.disabled = selected;
    switchButton.addEventListener('click', () => switchDatabase(database.databaseName));
    if (!database.isDefault) {
      const remove = addText(actions, 'button', '删除数据库', 'small-action danger');
      remove.addEventListener('click', () => removeDatabase(database));
    }
  }
  $('#headerDatabase').textContent = activeDatabase || '准备就绪';
  $('#editorDatabase').textContent = activeDatabase || '—';
  $('#manageTableDescription').textContent = `当前数据库：${activeDatabase || '—'}`;
}
async function refreshDatabases(preferred) {
  if (!student) return;
  try {
    const data = await api('/api/databases');
    databases = data.databases;
    const wanted = preferred || activeDatabase;
    activeDatabase = databases.some(db => db.databaseName === wanted) ? wanted : student.database;
    try { localStorage.setItem(`mysql-lab-database-${student.database}`, activeDatabase); } catch {}
    renderDatabases();
    await refreshSchema();
  } catch (error) { toastError('读取数据库失败', error); }
}
async function switchDatabase(databaseName) {
  if (activeDatabase === databaseName) return closeSidebar();
  activeDatabase = databaseName;
  try { localStorage.setItem(`mysql-lab-database-${student.database}`, databaseName); } catch {}
  renderDatabases();
  await refreshSchema();
  closeSidebar();
  toast('已切换数据库');
}
function openDatabaseModal() {
  if (!student) return setStudent(null);
  $('#databaseFormError').textContent = '';
  $('#databaseName').value = '';
  $('#databaseModal').hidden = false;
  $('#databaseName').focus();
  closeSidebar();
}
async function removeDatabase(database) {
  const typed = prompt(`删除“${database.name}”会永久删除其中所有表和数据。请输入 ${database.name} 确认：`);
  if (typed !== database.name) return;
  try {
    await api('/api/databases/delete', { method: 'POST', body: JSON.stringify({ database: database.databaseName }) });
    await refreshDatabases(activeDatabase === database.databaseName ? student.database : activeDatabase);
    toast('数据库已删除');
  } catch (error) { toastError('删除失败', error); }
}
async function refreshSchema() {
  if (!student || !activeDatabase) return;
  const list = $('#tableList');
  list.textContent = '';
  addText(list, 'div', '正在读取表结构…', 'empty-tables');
  try {
    const { tables } = await api(`/api/schema?database=${encodeURIComponent(activeDatabase)}`);
    list.textContent = '';
    renderTableCards(tables);
    if (!tables.length) addText(list, 'div', '还没有数据表，可使用 CREATE TABLE 创建', 'empty-tables');
    for (const table of tables) {
      const button = document.createElement('button');
      button.className = 'table-item';
      button.type = 'button';
      addText(button, 'span', '▦', 'table-icon');
      addText(button, 'span', table.name);
      addText(button, 'span', table.rows, 'row-count');
      const columns = document.createElement('div');
      columns.className = 'column-list';
      for (const column of table.columns) {
        const item = document.createElement('div');
        item.className = 'column-item';
        if (column.key === 'PRI') addText(item, 'span', '◆', 'primary-key');
        addText(item, 'span', `${column.name}  ${column.type}`);
        columns.append(item);
      }
      button.addEventListener('click', () => {
        button.classList.toggle('selected');
        columns.classList.toggle('open');
      });
      button.addEventListener('dblclick', () => {
        editor.value = `SELECT *\nFROM \`${table.name.replaceAll('`', '``')}\`\nLIMIT 100;`;
        syncLines();
        saveDraft();
        closeSidebar();
        editor.focus();
      });
      list.append(button, columns);
    }
  } catch (error) {
    list.textContent = '';
    addText(list, 'div', error.message, 'empty-tables');
    renderTableCards([]);
  }
}
function renderTableCards(tables) {
  const cards = $('#tableCards');
  cards.textContent = '';
  if (!tables.length) return addText(cards, 'div', '这个数据库还没有数据表。点击“创建表”开始。', 'manage-empty');
  for (const table of tables) {
    const card = addText(cards, 'div', '', 'table-card');
    addText(card, 'h3', `▦  ${table.name}`);
    addText(card, 'p', `${table.rows} 行 · ${table.columns.length} 个字段`);
    const columns = addText(card, 'div', '', 'table-columns');
    for (const column of table.columns.slice(0, 6)) addText(columns, 'span', column.name, 'column-pill');
    const actions = addText(card, 'div', '', 'table-card-actions');
    const view = addText(actions, 'button', '查看数据', 'small-action');
    view.addEventListener('click', () => loadTableSql(table.name, 'SELECT * FROM'));
    const describe = addText(actions, 'button', '查看结构', 'small-action');
    describe.addEventListener('click', () => loadTableSql(table.name, 'DESCRIBE'));
    const remove = addText(actions, 'button', '删除表', 'small-action danger');
    remove.addEventListener('click', async () => {
      if (!confirm(`确定永久删除数据表“${table.name}”及其中所有数据吗？`)) return;
      try {
        await api('/api/query', { method: 'POST', body: JSON.stringify({ database: activeDatabase, sql: `DROP TABLE \`${table.name.replaceAll('`', '``')}\`` }) });
        await refreshSchema();
        toast('数据表已删除');
      } catch (error) { toast(`删除失败：${error.message}`); }
    });
  }
}
function loadTableSql(tableName, command) {
  const quoted = `\`${tableName.replaceAll('`', '``')}\``;
  editor.value = command === 'DESCRIBE' ? `DESCRIBE ${quoted};` : `SELECT * FROM ${quoted} LIMIT 100;`;
  syncLines(); saveDraft(); showView('workspace'); runQuery();
}
function saveDraft() {
  if (!preferences.autoSave) return;
  try { localStorage.setItem('mysql-lab-draft', editor.value); } catch {}
}
function showSet(index) {
  const set = lastSets[index];
  const body = $('#resultBody');
  body.textContent = '';
  document.querySelectorAll('.result-tab').forEach((tab, i) => tab.classList.toggle('active', i === index));
  $('#resultCount').textContent = set.kind === 'rows' ? `${set.total} 行` : `${set.affectedRows} 行受影响`;
  if (set.kind === 'ok') {
    const wrap = addText(body, 'div', '', 'success-result');
    addText(wrap, 'div', '✓', 'state-symbol');
    addText(wrap, 'strong', '执行成功');
    addText(wrap, 'div', `${set.affectedRows} 行受影响${set.warningStatus ? ` · ${set.warningStatus} 条警告` : ''}`);
    return;
  }
  if (!set.rows.length) {
    const wrap = addText(body, 'div', '', 'success-result');
    addText(wrap, 'div', '✓', 'state-symbol');
    addText(wrap, 'strong', '查询成功');
    addText(wrap, 'div', '结果为空，试试调整查询条件。');
    return;
  }
  const table = document.createElement('table');
  table.className = 'result-table';
  const head = table.createTHead().insertRow();
  addText(head, 'th', '#', 'index-col');
  for (const column of set.columns) addText(head, 'th', column);
  const tbody = table.createTBody();
  set.rows.forEach((row, rowIndex) => {
    const tr = tbody.insertRow();
    addText(tr, 'td', rowIndex + 1, 'index-col');
    for (const column of set.columns) {
      const value = row[column];
      const cell = addText(tr, 'td', value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value), value === null ? 'null-value' : '');
      cell.title = cell.textContent;
    }
  });
  body.append(table);
  if (set.truncated) addText(body, 'div', `仅显示前 500 行，共 ${set.total} 行。请使用 LIMIT 缩小查询范围。`, 'result-note');
}
function showError(error) {
  const message = error.message || String(error);
  lastSets = [];
  $('#resultTabs').hidden = true;
  $('#resultCount').textContent = '执行失败';
  $('#resultMeta').textContent = '';
  const body = $('#resultBody');
  body.textContent = '';
  const wrap = addText(body, 'div', '', 'error-result');
  addText(wrap, 'div', '!', 'state-symbol');
  addText(wrap, 'strong', 'SQL 执行失败');
  addText(wrap, 'p', message);
  $('#editorError').hidden = false;
  $('#editorErrorTitle').textContent = `SQL 执行失败${error.line ? ` · 第 ${error.line} 行` : ''}${error.code ? ` · ${error.code}` : ''}`;
  $('#editorErrorMessage').textContent = message;
  $('#editorErrorHint').textContent = error.hint || '检查 SQL 语句和当前数据库后重试。';
}
async function runQuery() {
  if (!student) return setStudent(null);
  const sql = editor.value.trim();
  if (!sql) return toast('请先输入 SQL 语句');
  const button = $('#runQuery');
  button.disabled = true;
  button.querySelector('span:nth-child(2)').textContent = '运行中…';
  $('#resultCount').textContent = '正在查询';
  $('#editorError').hidden = true;
  try {
    const { sets, durationMs } = await api('/api/query', { method: 'POST', body: JSON.stringify({ sql, database: activeDatabase }) });
    lastSets = sets;
    $('#resultMeta').textContent = `${durationMs} ms · 执行成功`;
    const tabs = $('#resultTabs');
    tabs.textContent = '';
    tabs.hidden = sets.length <= 1;
    sets.forEach((_, index) => {
      const tab = addText(tabs, 'button', `结果 ${index + 1}`, 'result-tab');
      tab.addEventListener('click', () => showSet(index));
    });
    showSet(0);
    refreshSchema();
  } catch (error) { showError(error); }
  finally {
    button.disabled = false;
    button.querySelector('span:nth-child(2)').textContent = '运行查询';
  }
}

function progressKey() { return `mysql-lab-progress-${student?.database || 'guest'}`; }
function challengeDraftKey(id) { return `mysql-lab-challenge-${student?.database || 'guest'}-${id}`; }
async function loadChallenges() {
  try {
    ({ challenges } = await api('/api/challenges'));
    try {
      const saved = JSON.parse(localStorage.getItem(progressKey()) || '[]');
      passedChallenges = new Set(saved.filter(id => challenges.some(item => item.id === id)));
      selectedChallengeId = localStorage.getItem(`${progressKey()}-selected`) || selectedChallengeId;
    } catch { passedChallenges = new Set(); }
    selectedChallengeId = challenges.some(item => item.id === selectedChallengeId) ? selectedChallengeId : challenges[0]?.id;
    renderChallenges();
  } catch (error) { $('#challengeList').textContent = `题库加载失败：${error.message}。请确认本地服务已启动。`; }
}
function renderChallenges() {
  $('#challengeProgress').textContent = `${passedChallenges.size} / ${challenges.length}`;
  const list = $('#challengeList');
  list.textContent = '';
  for (const [index, challenge] of challenges.entries()) {
    const button = addText(list, 'button', '', `challenge-choice${challenge.id === selectedChallengeId ? ' active' : ''}`);
    button.type = 'button';
    addText(button, 'span', passedChallenges.has(challenge.id) ? '✓' : String(index + 1).padStart(2, '0'), 'challenge-number');
    const info = addText(button, 'span', '', 'challenge-choice-info');
    addText(info, 'strong', challenge.title);
    addText(info, 'small', `${challenge.level} · ${challenge.topic}`);
    button.addEventListener('click', () => {
      selectedChallengeId = challenge.id;
      try { localStorage.setItem(`${progressKey()}-selected`, challenge.id); } catch {}
      renderChallenges();
    });
  }
  renderChallengeDetail();
}
function renderChallengeDetail() {
  const challenge = challenges.find(item => item.id === selectedChallengeId);
  const root = $('#challengeDetail');
  root.textContent = '';
  if (!challenge) return addText(root, 'div', '选择一道题，开始练习。', 'challenge-empty');
  const heading = addText(root, 'div', '', 'challenge-heading');
  addText(heading, 'span', challenge.level, 'level-pill');
  addText(heading, 'span', challenge.topic, 'topic-label');
  addText(root, 'h3', challenge.title);
  addText(root, 'p', challenge.description, 'challenge-description');
  const lesson = addText(root, 'div', '', 'lesson-note');
  addText(lesson, 'strong', '知识卡片');
  addText(lesson, 'span', challenge.lesson);
  const editorLabel = addText(root, 'label', '你的 SQL', 'challenge-editor-label');
  const answer = document.createElement('textarea');
  answer.className = 'challenge-editor';
  answer.spellcheck = false;
  answer.autocapitalize = 'off';
  answer.setAttribute('aria-label', `${challenge.title} 的 SQL 答案`);
  editorLabel.append(answer);
  try { answer.value = localStorage.getItem(challengeDraftKey(challenge.id)) ?? challenge.starter; }
  catch { answer.value = challenge.starter; }
  answer.addEventListener('input', () => { try { localStorage.setItem(challengeDraftKey(challenge.id), answer.value); } catch {} });
  const actions = addText(root, 'div', '', 'challenge-actions');
  const submit = addText(actions, 'button', '提交判题 →', 'run-button');
  submit.type = 'button';
  const workspace = addText(actions, 'button', '到工作台实验', 'outline-button');
  workspace.type = 'button';
  const hint = addText(root, 'button', '需要一点提示？', 'hint-reveal');
  hint.type = 'button';
  const hintText = addText(root, 'div', challenge.hint, 'challenge-hint');
  hintText.hidden = true;
  hint.addEventListener('click', () => { hintText.hidden = !hintText.hidden; hint.textContent = hintText.hidden ? '需要一点提示？' : '收起提示'; });
  const verdict = addText(root, 'div', '', 'challenge-verdict');
  verdict.hidden = true;
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    submit.textContent = '正在判题…';
    verdict.hidden = true;
    try {
      const result = await api('/api/challenges/submit', { method: 'POST', body: JSON.stringify({ id: challenge.id, sql: answer.value }) });
      verdict.className = `challenge-verdict ${result.passed ? 'passed' : 'failed'}`;
      verdict.textContent = '';
      addText(verdict, 'strong', result.passed ? '✓ 通过挑战' : '再试一次');
      addText(verdict, 'p', result.feedback);
      if (!result.passed && preferences.showHints && result.hint) addText(verdict, 'small', `建议：${result.hint}`);
      if (result.passed) {
        passedChallenges.add(challenge.id);
        try { localStorage.setItem(progressKey(), JSON.stringify([...passedChallenges])); } catch {}
        const choice = [...$('#challengeList').children][challenges.findIndex(item => item.id === challenge.id)];
        choice?.querySelector('.challenge-number')?.replaceChildren(document.createTextNode('✓'));
        $('#challengeProgress').textContent = `${passedChallenges.size} / ${challenges.length}`;
      }
    } catch (error) {
      verdict.className = 'challenge-verdict failed';
      verdict.textContent = '';
      addText(verdict, 'strong', error.line ? `SQL 第 ${error.line} 行需要检查` : '提交遇到问题');
      addText(verdict, 'p', error.message);
      if (preferences.showHints) addText(verdict, 'small', `建议：${error.hint || challenge.hint}`);
    } finally {
      verdict.hidden = false;
      submit.disabled = false;
      submit.textContent = '提交判题 →';
      verdict.scrollIntoView({ behavior: preferences.reduceMotion ? 'auto' : 'smooth', block: 'center' });
    }
  });
  workspace.addEventListener('click', async () => {
    if (activeDatabase !== student.database) await switchDatabase(student.database);
    editor.value = answer.value;
    syncLines(); saveDraft(); showView('workspace'); editor.focus();
    toast('练习 SQL 已载入示例数据库的工作台');
  });
}
async function createMobileStudent(accessCode = '') {
  $('#welcomeModal').hidden = true;
  $('#resultCount').textContent = '正在准备本机练习空间';
  try {
    const data = await api('/api/session', { method: 'POST', body: JSON.stringify({ name: '本机学员', accessCode }) });
    setStudent(data.student);
    $('#resultCount').textContent = '等待运行';
  } catch (error) {
    if (error.code === 'SESSION_EXISTS' || error.message.includes('已有练习空间')) {
      const data = await api('/api/session');
      if (data.student) return setStudent(data.student);
    }
    setStudent(null);
    $('#welcomeDescription').textContent = `创建本机练习空间失败：${error.message}。请重试。`;
    $('#formError').textContent = error.hint || '';
  }
}

$('#welcomeForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#startButton');
  button.disabled = true;
  $('#formError').textContent = '';
  try {
    const { student } = await api('/api/session', { method: 'POST', body: JSON.stringify({ name: isPhone ? '本机学员' : $('#studentName').value, accessCode: $('#accessCode').value }) });
    setStudent(student);
    toast('专属练习空间已准备好');
  } catch (error) { $('#formError').textContent = `${error.message}。${error.hint || ''}`; }
  finally { button.disabled = false; }
});
$('#runQuery').addEventListener('click', runQuery);
$('#dismissError').addEventListener('click', () => { $('#editorError').hidden = true; });
$('#clearEditor').addEventListener('click', () => { editor.value = ''; syncLines(); saveDraft(); editor.focus(); });
$('#refreshSchema').addEventListener('click', () => refreshDatabases());
$('#navWorkspace').addEventListener('click', () => showView('workspace'));
$('#navManage').addEventListener('click', () => showView('manage'));
$('#navChallenges').addEventListener('click', () => showView('challenges'));
$('#navSettings').addEventListener('click', () => showView('settings'));
$('#mobileWorkspace').addEventListener('click', () => showView('workspace'));
$('#mobileManage').addEventListener('click', () => showView('manage'));
$('#mobileChallenges').addEventListener('click', () => showView('challenges'));
$('#mobileSettings').addEventListener('click', () => showView('settings'));
$('.settings-button').addEventListener('click', () => showView('settings'));
$('#runtimeSettings').hidden = !window.Android?.openSettings;
$('#runtimeSettings').addEventListener('click', () => window.Android?.openSettings?.());
$('#themeOptions').addEventListener('click', event => { const value = event.target.closest('[data-theme]')?.dataset.theme; if (['system', 'light', 'dark'].includes(value)) { preferences.theme = value; savePreferences(); } });
$('#accentOptions').addEventListener('click', event => { const value = event.target.closest('[data-accent]')?.dataset.accent; if (['blue', 'violet', 'mint', 'orange'].includes(value)) { preferences.accent = value; savePreferences(); } });
for (const key of ['fontSize', 'resultDensity', 'lineWrap', 'autoSave', 'showHints', 'reduceMotion']) {
  $(`#${key}`).addEventListener('change', event => { preferences[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value; savePreferences(); });
}
$('#clearProgress').addEventListener('click', () => {
  if (!student || !confirm('清除这台设备上的闯关记录？SQL 草稿和数据库内容仍会保留。')) return;
  passedChallenges.clear();
  try { localStorage.removeItem(progressKey()); } catch {}
  renderChallenges();
  toast('闯关进度已清除');
});
$('#profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  const errorText = $('#profileError');
  errorText.textContent = '';
  try {
    const data = await api('/api/profile', { method: 'POST', body: JSON.stringify({ name: $('#profileName').value }) });
    student = data.student;
    $('#headerName').textContent = student.name;
    $('#avatar').textContent = student.name.slice(0, 1).toUpperCase();
    toast('显示名称已更新');
  } catch (error) { errorText.textContent = `${error.message}。${error.hint || ''}`; }
});
$('#sidebarAddDatabase').addEventListener('click', openDatabaseModal);
$('#createDatabase').addEventListener('click', openDatabaseModal);
$('#cancelDatabase').addEventListener('click', () => { $('#databaseModal').hidden = true; });
$('#databaseModal').addEventListener('click', event => { if (event.target === $('#databaseModal')) $('#databaseModal').hidden = true; });
$('#databaseForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#saveDatabase');
  button.disabled = true;
  $('#databaseFormError').textContent = '';
  try {
    const { database } = await api('/api/databases', { method: 'POST', body: JSON.stringify({ name: $('#databaseName').value }) });
    $('#databaseModal').hidden = true;
    await refreshDatabases(database.databaseName);
    showView('manage');
    toast('数据库已创建并切换');
  } catch (error) { $('#databaseFormError').textContent = `${error.message}。${error.hint || ''}`; }
  finally { button.disabled = false; }
});
$('#createTable').addEventListener('click', () => {
  const name = prompt('输入新表名称（以字母开头，只使用字母、数字和下划线）：');
  if (name === null) return;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name)) return toast('表名格式不正确');
  editor.value = `CREATE TABLE \`${name}\` (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(100) NOT NULL\n);`;
  syncLines(); saveDraft(); showView('workspace'); editor.focus();
  toast('建表语句已载入，确认后运行即可');
});
$('#resetDatabase').addEventListener('click', async () => {
  if (!student || !confirm('确定重置你的数据库吗？你创建的表和修改的数据都会被删除。')) return;
  const button = $('#resetDatabase');
  button.disabled = true;
  try {
    await api('/api/reset', { method: 'POST', body: '{}' });
    await refreshSchema();
    toast('示例数据库已恢复');
    closeSidebar();
  } catch (error) { toastError('重置失败', error); }
  finally { button.disabled = false; }
});
$('#mobileSchema').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); });
$('#closeSchema').addEventListener('click', closeSidebar);
$('#scrim').addEventListener('click', closeSidebar);
document.querySelectorAll('[data-snippet]').forEach(button => button.addEventListener('click', () => {
  editor.value = snippets[button.dataset.snippet];
  syncLines();
  saveDraft();
  closeSidebar();
  editor.focus();
  toast('示例查询已载入编辑器');
}));
editor.addEventListener('input', () => { syncLines(); saveDraft(); });
editor.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); runQuery(); }
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText('  ', start, editor.selectionEnd, 'end');
    syncLines(); saveDraft();
  }
});
editor.addEventListener('scroll', () => { $('#lineNumbers').scrollTop = editor.scrollTop; });
try { const draft = localStorage.getItem('mysql-lab-draft'); if (preferences.autoSave && draft !== null) editor.value = draft; } catch {}
syncLines();
api('/api/session').then(({ student: existing, accessCodeRequired }) => {
  $('#accessCodeField').hidden = !accessCodeRequired;
  $('#accessCode').required = accessCodeRequired;
  if (isPhone) {
    $('#studentNameField').hidden = true;
    $('#studentName').required = false;
    $('#welcomeDescription').textContent = accessCodeRequired ? '输入练习码后，应用会自动准备本机练习空间。' : '正在自动准备本机练习空间…';
    $('#welcomeNote').textContent = '练习数据与设置保存在本机。';
    if (existing) setStudent(existing);
    else if (accessCodeRequired) setStudent(null);
    else createMobileStudent();
  } else setStudent(existing);
}).catch(error => { setStudent(null); $('#formError').textContent = `连接失败：${error.message}。${error.hint || ''}`; });
