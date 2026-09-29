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

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
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
  $('#headerDatabase').textContent = value?.database || '准备就绪';
  $('#sidebarDatabase').textContent = value?.database || '—';
  if (value) refreshSchema();
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
async function refreshSchema() {
  if (!student) return;
  const list = $('#tableList');
  list.textContent = '';
  addText(list, 'div', '正在读取表结构…', 'empty-tables');
  try {
    const { tables } = await api('/api/schema');
    list.textContent = '';
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
  }
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
function showError(message) {
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
}
async function runQuery() {
  if (!student) return setStudent(null);
  const sql = editor.value.trim();
  if (!sql) return toast('请先输入 SQL 语句');
  const button = $('#runQuery');
  button.disabled = true;
  button.querySelector('span:nth-child(2)').textContent = '运行中…';
  $('#resultCount').textContent = '正在查询';
  try {
    const { sets, durationMs } = await api('/api/query', { method: 'POST', body: JSON.stringify({ sql }) });
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
  } catch (error) { showError(error.message); }
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
$('#clearEditor').addEventListener('click', () => { editor.value = ''; syncLines(); saveDraft(); editor.focus(); });
$('#refreshSchema').addEventListener('click', refreshSchema);
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
