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

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`);
    error.code = data.code;
    error.hint = data.hint;
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
  toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
}
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
    try { activeDatabase = localStorage.getItem(`mysql-lab-database-${value.database}`) || value.database; }
    catch { activeDatabase = value.database; }
    refreshDatabases();
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
  $('#navWorkspace').classList.toggle('active', view === 'workspace');
  $('#navManage').classList.toggle('active', view === 'manage');
  $('#breadcrumbCurrent').textContent = view === 'workspace' ? 'SQL 查询' : '数据库管理';
  $('#pageHeading').textContent = view === 'workspace' ? 'SQL 工作台' : '数据库管理';
  $('#pageDescription').textContent = view === 'workspace' ? '写下你的查询，探索数据背后的答案。' : '创建数据库、浏览数据表，整理你的练习空间。';
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
  } catch (error) { toast(`读取数据库失败：${error.message}`); }
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
  } catch (error) { toast(`删除失败：${error.message}`); }
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

$('#welcomeForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#startButton');
  button.disabled = true;
  $('#formError').textContent = '';
  try {
    const { student } = await api('/api/session', { method: 'POST', body: JSON.stringify({ name: $('#studentName').value, accessCode: $('#accessCode').value }) });
    setStudent(student);
    toast('专属练习空间已准备好');
  } catch (error) { $('#formError').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#runQuery').addEventListener('click', runQuery);
$('#dismissError').addEventListener('click', () => { $('#editorError').hidden = true; });
$('#clearEditor').addEventListener('click', () => { editor.value = ''; syncLines(); saveDraft(); editor.focus(); });
$('#refreshSchema').addEventListener('click', () => refreshDatabases());
$('#navWorkspace').addEventListener('click', () => showView('workspace'));
$('#navManage').addEventListener('click', () => showView('manage'));
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
  } catch (error) { $('#databaseFormError').textContent = error.message; }
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
  } catch (error) { toast(error.message); }
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
try { const draft = localStorage.getItem('mysql-lab-draft'); if (draft !== null) editor.value = draft; } catch {}
syncLines();
api('/api/session').then(({ student, accessCodeRequired }) => { $('#accessCodeField').hidden = !accessCodeRequired; $('#accessCode').required = accessCodeRequired; setStudent(student); }).catch(error => { setStudent(null); $('#formError').textContent = `连接失败：${error.message}`; });
