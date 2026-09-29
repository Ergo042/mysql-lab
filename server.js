import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

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
async function studentConnection(student) {
  return mysql.createConnection({ host: HOST, user: student.db_user, password: student.db_password, database: student.db_name, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: true, connectTimeout: 10000 });
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
  try {
    await admin.query(`CREATE DATABASE ${quoteId(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [dbUser, dbPassword]);
    await admin.query(`GRANT ALL PRIVILEGES ON ${quoteId(dbName)}.* TO ?@'%'`, [dbUser]);
    connection = await mysql.createConnection({ host: HOST, user: dbUser, password: dbPassword, database: dbName, multipleStatements: true });
    await seed(connection);
    await admin.query(`INSERT INTO ${META_DB}.students (id, display_name, db_name, db_user, db_password, token_hash) VALUES (?, ?, ?, ?, ?, ?)`, [id, name, dbName, dbUser, dbPassword, tokenHash(token)]);
    return { token, student: { id, display_name: name, db_name: dbName } };
  } catch (cause) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteId(dbName)}`).catch(() => {});
    await admin.query(`DROP USER IF EXISTS ?@'%'`, [dbUser]).catch(() => {});
    throw cause;
  } finally { await connection?.end().catch(() => {}); }
}
async function schema(student) {
  const connection = await studentConnection(student);
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
async function runQuery(student, sql) {
  const connection = await studentConnection(student);
  const start = performance.now();
  try {
    await connection.query('SET SESSION max_execution_time = 10000');
    const [result, fields] = await connection.query({ sql, timeout: 15000 });
    const multi = Array.isArray(fields) && (Array.isArray(fields[0]) || fields[0] == null);
    const sets = multi ? result.map((item, index) => formatResult(item, fields[index])) : [formatResult(result, fields)];
    return { sets, durationMs: Math.round(performance.now() - start) };
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
  if (!/^(index\.html|style\.css|app\.js|favicon\.svg)$/.test(filename)) return error(res, 404, '页面不存在');
  const file = await readFile(path.join(publicDir, filename));
  res.writeHead(200, { 'content-type': mime[path.extname(filename)], 'content-length': file.length, 'cache-control': filename === 'index.html' ? 'no-cache' : 'public, max-age=3600' });
  res.end(file);
}
async function handler(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'POST' && pathname.startsWith('/api/')) {
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
    if (pathname === '/api/schema' && req.method === 'GET') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      return json(res, 200, { tables: await schema(current) });
    }
    if (pathname === '/api/query' && req.method === 'POST') {
      const current = await session(req);
      if (!current) return error(res, 401, '请先创建练习空间');
      const { sql } = await bodyJson(req);
      if (typeof sql !== 'string' || !sql.trim()) return error(res, 400, '请输入 SQL 语句');
      if (sql.length > 20_000) return error(res, 400, 'SQL 不能超过 20,000 个字符');
      const result = await runQuery(current, sql);
      return json(res, 200, result);
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
  http.createServer(handler).listen(PORT, '0.0.0.0', () => console.log(`MySQL Lab listening on ${PORT}`));
}
init().catch(error => { console.error(error); process.exit(1); });
