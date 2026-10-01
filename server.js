import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { challenges, publicChallenges, validateAnswer } from './challenges.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.MYSQL_HOST || 'localhost';
const ROOT_PASSWORD = process.env.MYSQL_ROOT_PASSWORD || '';
const ACCESS_CODE = process.env.LAB_ACCESS_CODE || '';
const META_DB = 'mysql_lab_app';
const COOKIE = 'mysql_lab_session';
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
let admin;

function quoteId(value) { return `\`${value.replaceAll('`', '``')}\``; }
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function error(res, status, message) { json(res, status, { error: message }); }
function sqlFailure(cause) {
  const hints = {
    ER_PARSE_ERROR: '检查关键字、逗号、括号和引号是否完整。',
    ER_NO_SUCH_TABLE: '表不存在。请检查表名，或在左侧刷新表结构。',
    ER_BAD_FIELD_ERROR: '列名不存在。展开左侧数据表核对字段名称。',
    ER_DUP_ENTRY: '主键或唯一索引的值重复，请换一个值。',
    ER_TABLE_EXISTS_ERROR: '同名数据表已经存在，请改名或使用 IF NOT EXISTS。',
    ER_BAD_DB_ERROR: '数据库不存在。请切换数据库，或在管理页面重新创建。',
    ER_DBACCESS_DENIED_ERROR: '当前学生只能访问自己的数据库。',
    ER_TABLEACCESS_DENIED_ERROR: '当前学生无权访问这张表。',
    ER_DATA_TOO_LONG: '写入内容超过字段允许的长度。',
    ER_NO_DEFAULT_FOR_FIELD: '有必填字段没有提供值。',
    ER_TRUNCATED_WRONG_VALUE: '值的格式与字段类型不匹配。',
    ER_LOCK_WAIT_TIMEOUT: '等待数据库锁超时，请稍后重试。',
    ER_BAD_NULL_ERROR: '必填字段不能写入 NULL；检查表结构并提供有效值。',
    ER_ROW_IS_REFERENCED_2: '这条记录仍被其他表引用；先处理关联记录。',
    ER_NO_REFERENCED_ROW_2: '关联的记录不存在；先确认外键引用的 id 已存在。',
    ER_WRONG_VALUE_COUNT_ON_ROW: 'INSERT 的列数和值的数量不一致；逐个核对。',
    ER_NON_UNIQ_ERROR: '多个表中存在同名列；用表别名限定列，例如 s.name。',
    ER_GROUP_FIELD_WITH_GROUP: '检查 GROUP BY 与 SELECT 中的非聚合列。',
    ER_WRONG_FIELD_WITH_GROUP: '分组查询中的非聚合列需要写入 GROUP BY。',
    ER_ACCESS_DENIED_ERROR: '数据库连接被拒绝；可在设置中查看运行环境与安装日志。',
    ER_CON_COUNT_ERROR: '数据库连接数过多；请稍后再试或重启应用。'
  };
  const message = cause.sqlMessage || cause.message || 'SQL 执行失败';
  const line = Number(/at line (\d+)/i.exec(message)?.[1]) || null;
  return { error: message, code: cause.code || 'QUERY_ERROR', hint: hints[cause.code] || (cause.code === 'PROTOCOL_SEQUENCE_TIMEOUT' ? '查询超时，请缩小数据范围后重试。' : '检查 SQL 语句和当前数据库后重试。'), line };
}
function cookieToken(req) {
  const item = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  const token = item?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
async function bodyJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 50_000) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('JSON 格式无效'), { status: 400 }); }
}
async function session(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const [rows] = await admin.query(`SELECT id, display_name, db_name, db_user, db_password FROM ${META_DB}.students WHERE token_hash = ?`, [tokenHash(token)]);
  return rows[0] || null;
}
async function studentConnection(student, database = student.db_name) {
  return mysql.createConnection({ host: HOST, user: student.db_user, password: student.db_password, database, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: true, connectTimeout: 10000 });
}
async function studentDatabases(student) {
  const [rows] = await admin.query(`SELECT db_name AS databaseName, display_name AS name, is_default AS isDefault FROM ${META_DB}.student_databases WHERE student_id = ? ORDER BY is_default DESC, created_at ASC`, [student.id]);
  return rows.map(row => ({ ...row, isDefault: !!row.isDefault }));
}
async function ownedDatabase(student, name) {
  const database = name || student.db_name;
  if (typeof database !== 'string' || !/^lab_[a-f0-9]{16}(?:_[a-z][a-z0-9_]{0,23})?$/.test(database)) return null;
  const [rows] = await admin.query(`SELECT db_name FROM ${META_DB}.student_databases WHERE student_id = ? AND db_name = ?`, [student.id, database]);
  return rows.length ? database : null;
}
async function createDatabase(student, rawName) {
  const name = typeof rawName === 'string' ? rawName.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9_]{0,23}$/.test(name)) throw Object.assign(new Error('数据库名称需以字母开头，只能包含小写字母、数字和下划线，最多 24 个字符'), { status: 400 });
  const databases = await studentDatabases(student);
  if (databases.length >= 10) throw Object.assign(new Error('每位学生最多可创建 9 个额外数据库'), { status: 400 });
  if (databases.some(db => db.name === name)) throw Object.assign(new Error('这个数据库名称已存在'), { status: 409 });
  const databaseName = `lab_${student.id}_${name}`;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE ${quoteId(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await admin.query(`GRANT ALL PRIVILEGES ON ${quoteId(databaseName)}.* TO ?@'%'`, [student.db_user]);
    await admin.query(`INSERT INTO ${META_DB}.student_databases (student_id, db_name, display_name, is_default) VALUES (?, ?, ?, 0)`, [student.id, databaseName, name]);
    return { databaseName, name, isDefault: false };
  } catch (cause) {
    if (created) {
      await admin.query(`REVOKE ALL PRIVILEGES ON ${quoteId(databaseName)}.* FROM ?@'%'`, [student.db_user]).catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${quoteId(databaseName)}`).catch(() => {});
    }
    throw cause;
  }
}
async function deleteDatabase(student, databaseName) {
  if (!databaseName || databaseName === student.db_name) throw Object.assign(new Error('示例数据库不能删除，可使用重置功能恢复'), { status: 400 });
  const owned = await ownedDatabase(student, databaseName);
  if (!owned) throw Object.assign(new Error('数据库不存在或不属于当前学生'), { status: 404 });
  await admin.query(`REVOKE ALL PRIVILEGES ON ${quoteId(owned)}.* FROM ?@'%'`, [student.db_user]);
  await admin.query(`DROP DATABASE IF EXISTS ${quoteId(owned)}`);
  await admin.query(`DELETE FROM ${META_DB}.student_databases WHERE student_id = ? AND db_name = ?`, [student.id, owned]);
}
async function seed(connection) {
  await connection.query(`CREATE TABLE courses (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80) NOT NULL, teacher VARCHAR(80) NOT NULL, credits INT NOT NULL)`);
  await connection.query(`CREATE TABLE students (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80) NOT NULL, grade VARCHAR(20) NOT NULL, joined_at DATE NOT NULL)`);
  await connection.query(`CREATE TABLE enrollments (student_id INT NOT NULL, course_id INT NOT NULL, score DECIMAL(5,1), PRIMARY KEY (student_id, course_id), FOREIGN KEY (student_id) REFERENCES students(id), FOREIGN KEY (course_id) REFERENCES courses(id))`);
  await connection.query(`INSERT INTO courses (name, teacher, credits) VALUES ('数据库基础', '陈老师', 3), ('Web 开发', '李老师', 4), ('数据分析', '王老师', 3), ('算法入门', '赵老师', 4)`);
  await connection.query(`INSERT INTO students (name, grade, joined_at) VALUES ('林同学', '2024级', '2024-09-01'), ('周同学', '2024级', '2024-09-01'), ('吴同学', '2023级', '2023-09-01'), ('郑同学', '2023级', '2023-09-01'), ('许同学', '2024级', '2024-09-01')`);
  await connection.query(`INSERT INTO enrollments VALUES (1,1,92.0), (1,2,87.5), (2,1,85.0), (2,3,94.0), (3,2,90.0), (3,4,78.5), (4,1,88.0), (5,3,91.5)`);
}
async function createStudent(name) {
  const id = crypto.randomBytes(8).toString('hex');
  const dbName = `lab_${id}`;
  const dbUser = `u_${id}`;
  const dbPassword = crypto.randomBytes(24).toString('base64url');
  const token = crypto.randomBytes(32).toString('hex');
  let connection;
  let metadataConnection;
  try {
    await admin.query(`CREATE DATABASE ${quoteId(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [dbUser, dbPassword]);
    await admin.query(`GRANT ALL PRIVILEGES ON ${quoteId(dbName)}.* TO ?@'%'`, [dbUser]);
    connection = await mysql.createConnection({ host: HOST, user: dbUser, password: dbPassword, database: dbName, multipleStatements: true });
    await seed(connection);
    metadataConnection = await admin.getConnection();
    await metadataConnection.beginTransaction();
    await metadataConnection.query(`INSERT INTO ${META_DB}.students (id, display_name, db_name, db_user, db_password, token_hash) VALUES (?, ?, ?, ?, ?, ?)`, [id, name, dbName, dbUser, dbPassword, tokenHash(token)]);
    await metadataConnection.query(`INSERT INTO ${META_DB}.student_databases (student_id, db_name, display_name, is_default) VALUES (?, ?, '示例数据库', 1)`, [id, dbName]);
    await metadataConnection.commit();
    return { token, student: { id, display_name: name, db_name: dbName } };
  } catch (cause) {
    await metadataConnection?.rollback().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${quoteId(dbName)}`).catch(() => {});
    await admin.query(`DROP USER IF EXISTS ?@'%'`, [dbUser]).catch(() => {});
    throw cause;
  } finally {
    metadataConnection?.release();
    await connection?.end().catch(() => {});
  }
}
async function schema(student, database) {
  const connection = await studentConnection(student, database);
  try {
    const [tables] = await connection.query('SHOW FULL TABLES');
    const output = [];
    for (const row of tables) {
      const name = Object.values(row)[0];
      const [columns] = await connection.query(`SHOW COLUMNS FROM ${quoteId(name)}`);
      const [countRows] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteId(name)}`);
      output.push({ name, rows: countRows[0].count, columns: columns.map(c => ({ name: c.Field, type: c.Type, key: c.Key })) });
    }
    return output;
  } finally { await connection.end(); }
}
function formatResult(result, fields) {
  if (Array.isArray(result)) {
    const columns = (fields || []).map(field => field.name);
    const rows = result.slice(0, 500).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Buffer.isBuffer(value) ? `0x${value.toString('hex')}` : value])));
    return { kind: 'rows', columns, rows, total: result.length, truncated: result.length > 500 };
  }
  return { kind: 'ok', affectedRows: result.affectedRows || 0, changedRows: result.changedRows || 0, warningStatus: result.warningStatus || 0 };
}
async function runQuery(student, database, sql) {
  const connection = await studentConnection(student, database);
  const start = performance.now();
  try {
    await connection.query('SET SESSION max_execution_time = 10000');
    const [result, fields] = await connection.query({ sql, timeout: 15000 });
    const multi = Array.isArray(fields) && (Array.isArray(fields[0]) || fields[0] == null);
    const sets = multi ? result.map((item, index) => formatResult(item, fields[index])) : [formatResult(result, fields)];
    return { sets, durationMs: Math.round(performance.now() - start) };
  } finally { await connection.end().catch(() => {}); }
}
function canonicalRows(rows, ordered) {
  const normalized = rows.map(row => Object.values(row).map(value => value === null ? null : String(value)));
  return ordered ? normalized : normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function missingSkill(id, sql) {
  const rules = {
    'first-select': [[/\bORDER\s+BY\b/i, '这题需要用 ORDER BY 按学生 id 排序。']],
    'filter-grade': [[/\bWHERE\b/i, '这题需要用 WHERE 筛选年级。'], [/\bORDER\s+BY\b/i, '还需要用 ORDER BY 按 id 排序。']],
    credits: [[/\bWHERE\b/i, '这题需要用 WHERE 筛选学分。'], [/\bORDER\s+BY\b/i, '还需要用 ORDER BY 按课程 id 排序。']],
    'top-score': [[/\bORDER\s+BY\b/i, '先用 ORDER BY 给成绩排序。'], [/\bDESC\b/i, '成绩需要从高到低，使用 DESC。'], [/\bLIMIT\s+3\b/i, '只保留前三名，使用 LIMIT 3。']],
    'join-names': [[/\bJOIN\b/i, '需要用 JOIN 连接学生、课程和选课记录。'], [/\bORDER\s+BY\b/i, '还需要按成绩排序。']],
    'count-students': [[/\bCOUNT\s*\(/i, '请使用 COUNT 统计人数。']],
    'group-grade': [[/\bGROUP\s+BY\b/i, '请使用 GROUP BY 按年级分组。'], [/\bCOUNT\s*\(/i, '请用 COUNT 统计每组人数。']],
    'average-score': [[/\bJOIN\b/i, '请先连接课程与选课记录。'], [/\bGROUP\s+BY\b/i, '请按课程分组。'], [/\bAVG\s*\(/i, '请用 AVG 计算平均分。'], [/\bROUND\s*\(/i, '请用 ROUND 保留一位小数。']]
  };
  return rules[id]?.find(([pattern]) => !pattern.test(sql))?.[1] || null;
}
async function judgeChallenge(student, challenge, sql) {
  const missing = missingSkill(challenge.id, sql);
  if (missing) return { passed: false, feedback: missing, hint: challenge.hint };
  const connection = await mysql.createConnection({ host: HOST, user: student.db_user, password: student.db_password, database: student.db_name, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false, connectTimeout: 10000 });
  try {
    await connection.query('SET SESSION max_execution_time = 6000');
    const [expected, expectedFields] = await connection.query({ sql: challenge.expected, timeout: 8000 });
    const [actual, actualFields] = await connection.query({ sql, timeout: 8000 });
    if (!Array.isArray(actual)) return { passed: false, feedback: '请提交能返回结果行的 SELECT 查询。', hint: challenge.hint };
    if (actual.length > 500) return { passed: false, feedback: '查询返回超过 500 行；请缩小结果范围。', hint: challenge.hint };
    const columns = actualFields.map(field => field.name);
    const wantedColumns = expectedFields.map(field => field.name);
    if (JSON.stringify(columns) !== JSON.stringify(wantedColumns)) return { passed: false, feedback: `列名或顺序需要调整。目标列：${wantedColumns.join('、')}；当前列：${columns.join('、') || '无'}。`, hint: challenge.hint };
    if (actual.length !== expected.length) return { passed: false, feedback: `行数还不对：期望 ${expected.length} 行，当前 ${actual.length} 行。检查筛选、连接或分组条件。`, hint: challenge.hint };
    const same = JSON.stringify(canonicalRows(actual, challenge.ordered)) === JSON.stringify(canonicalRows(expected, challenge.ordered));
    return same
      ? { passed: true, feedback: `通过！${actual.length} 行结果均正确。`, lesson: challenge.lesson }
      : { passed: false, feedback: challenge.ordered ? '行内容或顺序与目标结果不同；检查筛选条件和 ORDER BY。' : '行内容与目标结果不同；检查计算、连接或分组条件。', hint: challenge.hint };
  } finally { await connection.end().catch(() => {}); }
}
async function resetStudent(student) {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteId(student.db_name)}`);
  await admin.query(`CREATE DATABASE ${quoteId(student.db_name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const connection = await studentConnection(student);
  try { await seed(connection); }
  finally { await connection.end(); }
}
async function staticFile(req, res, pathname) {
  const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^(index\.html|style\.css|mobile\.css|experience\.css|app\.js|favicon\.svg)$/.test(filename)) return error(res, 404, '页面不存在');
  const file = await readFile(path.join(publicDir, filename));
  res.writeHead(200, { 'content-type': mime[path.extname(filename)], 'content-length': file.length, 'cache-control': 'no-store' });
  res.end(file);
}
async function handler(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  const pathname = requestUrl.pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { status: 'ok' });
    if (['POST', 'DELETE'].includes(req.method) && pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return error(res, 403, '跨站请求已拒绝');
    }
    if (pathname === '/api/session' && req.method === 'GET') {
      const current = await session(req);
      return json(res, 200, { student: current ? { name: current.display_name, database: current.db_name } : null, accessCodeRequired: !!ACCESS_CODE });
    }
    if (pathname === '/api/session' && req.method === 'POST') {
      if (await session(req)) return error(res, 409, '当前浏览器已有练习空间');
      const { name, accessCode } = await bodyJson(req);
      if (ACCESS_CODE) {
        const provided = typeof accessCode === 'string' ? accessCode : '';
        const expectedHash = crypto.createHash('sha256').update(ACCESS_CODE).digest();
        const providedHash = crypto.createHash('sha256').update(provided).digest();
        if (!crypto.timingSafeEqual(expectedHash, providedHash)) return error(res, 403, '练习码不正确');
      }
      const displayName = typeof name === 'string' ? name.trim() : '';
      if (displayName.length < 1 || displayName.length > 24) return error(res, 400, '请输入 1–24 个字符的昵称');
      const created = await createStudent(displayName);
      res.setHeader('set-cookie', `${COOKIE}=${created.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
      return json(res, 201, { student: { name: displayName, database: created.student.db_name } });
    }
    if (pathname === '/api/session' && req.method === 'DELETE') {
      res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/profile' && req.method === 'POST') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      const { name } = await bodyJson(req);
      const displayName = typeof name === 'string' ? name.trim() : '';
      if (displayName.length < 1 || displayName.length > 24) return error(res, 400, '名称需为 1–24 个字符');
      await admin.query(`UPDATE ${META_DB}.students SET display_name = ? WHERE id = ?`, [displayName, current.id]);
      return json(res, 200, { student: { name: displayName, database: current.db_name } });
    }
    if (pathname === '/api/challenges' && req.method === 'GET') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      return json(res, 200, { challenges: publicChallenges() });
    }
    if (pathname === '/api/challenges/submit' && req.method === 'POST') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      const { id, sql } = await bodyJson(req);
      const challenge = challenges.find(item => item.id === id);
      if (!challenge) return error(res, 404, '题目不存在，请刷新题库');
      const invalid = validateAnswer(sql);
      if (invalid) return json(res, 400, { error: invalid, hint: challenge.hint });
      try { return json(res, 200, await judgeChallenge(current, challenge, sql)); }
      catch (cause) { return json(res, 400, sqlFailure(cause)); }
    }
    if (pathname === '/api/schema' && req.method === 'GET') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      const database = await ownedDatabase(current, requestUrl.searchParams.get('database'));
      if (!database) return error(res, 404, '数据库不存在或不属于当前学生');
      return json(res, 200, { tables: await schema(current, database), database });
    }
    if (pathname === '/api/databases' && req.method === 'GET') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      return json(res, 200, { databases: await studentDatabases(current) });
    }
    if (pathname === '/api/databases' && req.method === 'POST') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      const { name } = await bodyJson(req);
      return json(res, 201, { database: await createDatabase(current, name) });
    }
    if (pathname === '/api/databases/delete' && req.method === 'POST') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      const { database } = await bodyJson(req);
      await deleteDatabase(current, database);
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/query' && req.method === 'POST') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      const { sql, database: requestedDatabase } = await bodyJson(req);
      if (typeof sql !== 'string' || !sql.trim()) return error(res, 400, '请输入 SQL 语句');
      if (sql.length > 20_000) return error(res, 400, 'SQL 不能超过 20,000 个字符');
      const database = await ownedDatabase(current, requestedDatabase);
      if (!database) return error(res, 404, '数据库不存在或不属于当前学生');
      try { return json(res, 200, await runQuery(current, database, sql)); }
      catch (cause) {
        console.error('Student SQL error:', cause.code, cause.sqlMessage || cause.message);
        return json(res, 400, sqlFailure(cause));
      }
    }
    if (pathname === '/api/reset' && req.method === 'POST') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      await resetStudent(current);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && !pathname.startsWith('/api/')) return await staticFile(req, res, pathname);
    return error(res, 404, '接口不存在');
  } catch (cause) {
    const message = cause.sqlMessage || cause.message || '服务器错误';
    console.error(cause);
    return error(res, cause.status || (cause.code?.startsWith('ER_') ? 400 : 500), message);
  }
}
async function init() {
  if (!ROOT_PASSWORD) throw new Error('MYSQL_ROOT_PASSWORD is required');
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      admin = await mysql.createPool({ host: HOST, user: 'root', password: ROOT_PASSWORD, connectionLimit: 5, waitForConnections: true });
      await admin.query('SELECT 1');
      break;
    } catch (error) {
      await admin?.end().catch(() => {});
      if (attempt === 29) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  await admin.query(`CREATE DATABASE IF NOT EXISTS ${META_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`CREATE TABLE IF NOT EXISTS ${META_DB}.students (id CHAR(16) PRIMARY KEY, display_name VARCHAR(24) NOT NULL, db_name VARCHAR(32) NOT NULL UNIQUE, db_user VARCHAR(32) NOT NULL UNIQUE, db_password VARCHAR(64) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await admin.query(`CREATE TABLE IF NOT EXISTS ${META_DB}.student_databases (student_id CHAR(16) NOT NULL, db_name VARCHAR(64) NOT NULL UNIQUE, display_name VARCHAR(24) NOT NULL, is_default BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (student_id, db_name), UNIQUE KEY student_name (student_id, display_name), FOREIGN KEY (student_id) REFERENCES ${META_DB}.students(id) ON DELETE CASCADE)`);
  await admin.query(`INSERT IGNORE INTO ${META_DB}.student_databases (student_id, db_name, display_name, is_default) SELECT id, db_name, '示例数据库', 1 FROM ${META_DB}.students`);
  const listenHost = process.env.LISTEN_HOST || '0.0.0.0';
  http.createServer(handler).listen(PORT, listenHost, () => console.log(`MySQL Lab listening on ${listenHost}:${PORT}`));
}
init().catch(error => { console.error(error); process.exit(1); });
