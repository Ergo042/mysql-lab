export const challenges = [
  {
    id: 'first-select', level: '入门', topic: 'SELECT · 排序', title: '认识学生名单',
    description: '列出所有学生的姓名和年级，按学生 id 从小到大排列。输出列名依次为 name、grade。',
    starter: 'SELECT name, grade\nFROM students;',
    hint: 'SELECT 后只写需要的两列，再用 ORDER BY id 排序。',
    lesson: 'SELECT 选择列，FROM 指定表，ORDER BY 控制结果顺序。',
    expected: 'SELECT name, grade FROM students ORDER BY id', ordered: true
  },
  {
    id: 'filter-grade', level: '入门', topic: 'WHERE · 条件', title: '筛选 2024 级',
    description: '找出 2024 级学生的姓名。输出一列 name，按 id 升序。',
    starter: 'SELECT name\nFROM students;',
    hint: "年级是文本，比较时要写成 '2024级'。", lesson: 'WHERE 在排序前筛选记录；字符串需要单引号。',
    expected: "SELECT name FROM students WHERE grade = '2024级' ORDER BY id", ordered: true
  },
  {
    id: 'credits', level: '入门', topic: '比较运算', title: '找到高学分课程',
    description: '列出学分不少于 4 的课程名称与教师。输出 name、teacher，按课程 id 升序。',
    starter: 'SELECT name, teacher\nFROM courses;',
    hint: '“不少于”对应 >=。', lesson: '比较运算符可在 WHERE 中过滤数字列。',
    expected: 'SELECT name, teacher FROM courses WHERE credits >= 4 ORDER BY id', ordered: true
  },
  {
    id: 'top-score', level: '进阶', topic: 'ORDER BY · LIMIT', title: '前三名成绩',
    description: '从选课记录中找出最高的 3 条成绩。输出 student_id、score，按 score 降序。',
    starter: 'SELECT student_id, score\nFROM enrollments;',
    hint: 'DESC 表示降序，LIMIT 3 只取前三行。', lesson: 'ORDER BY 先排序，LIMIT 再限制返回行数。',
    expected: 'SELECT student_id, score FROM enrollments ORDER BY score DESC LIMIT 3', ordered: true
  },
  {
    id: 'join-names', level: '进阶', topic: 'JOIN · 多表', title: '谁选了什么课',
    description: '连接三张表，列出学生姓名、课程名称和成绩。列别名依次为 student、course、score，按成绩降序。',
    starter: 'SELECT s.name AS student, c.name AS course, e.score AS score\nFROM enrollments e\nJOIN students s ON s.id = e.student_id;',
    hint: '选课表中 student_id 对应 students.id，course_id 对应 courses.id。',
    lesson: 'JOIN 用 ON 指定两张表的关联键，别名可让查询更清晰。',
    expected: 'SELECT s.name AS student, c.name AS course, e.score AS score FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses c ON c.id = e.course_id ORDER BY e.score DESC', ordered: true
  },
  {
    id: 'count-students', level: '进阶', topic: 'COUNT · 聚合', title: '统计学生人数',
    description: '统计学生总人数，输出列名 total。',
    starter: 'SELECT *\nFROM students;',
    hint: 'COUNT(*) 统计行数，AS total 指定输出列名。', lesson: '聚合函数将多行汇总为一个值。',
    expected: 'SELECT COUNT(*) AS total FROM students'
  },
  {
    id: 'group-grade', level: '挑战', topic: 'GROUP BY · 分组', title: '各年级有多少人',
    description: '按年级统计学生人数，输出 grade、total，按 grade 升序。',
    starter: 'SELECT grade\nFROM students;',
    hint: 'SELECT 中的非聚合列 grade 也应写在 GROUP BY 中。', lesson: 'GROUP BY 先按共同的值分组，再对每组应用 COUNT。',
    expected: 'SELECT grade, COUNT(*) AS total FROM students GROUP BY grade ORDER BY grade', ordered: true
  },
  {
    id: 'average-score', level: '挑战', topic: 'JOIN · AVG', title: '课程平均分',
    description: '计算每门有选课记录的课程平均分，保留一位小数。输出 course、average_score，按平均分降序。',
    starter: 'SELECT c.name AS course, e.score\nFROM courses c\nJOIN enrollments e ON e.course_id = c.id;',
    hint: '用 AVG(score) 求平均值、ROUND(..., 1) 保留一位小数，再按课程分组。',
    lesson: '连接后分组可统计关联数据；ROUND 控制数值精度。',
    expected: 'SELECT c.name AS course, ROUND(AVG(e.score), 1) AS average_score FROM courses c JOIN enrollments e ON e.course_id = c.id GROUP BY c.id, c.name ORDER BY average_score DESC', ordered: true
  }
];

export function publicChallenges() {
  return challenges.map(({ expected, ordered, ...visible }) => visible);
}

export function validateAnswer(sql) {
  if (typeof sql !== 'string' || !sql.trim()) return '先写一条 SELECT 查询再提交。';
  if (sql.length > 5000) return '练习查询不能超过 5000 个字符。';
  const clean = sql.trim().replace(/;\s*$/, '').trim();
  if (!/^SELECT\b/i.test(clean)) return '练习判题只接受 SELECT 查询；修改数据请到 SQL 工作台。';
  if (/[;#]|--|\/\*|\*\//.test(clean)) return '练习判题只接受一条不含注释的 SELECT 查询。';
  if (/\b(INTO|OUTFILE|DUMPFILE|SLEEP|BENCHMARK|LOAD_FILE|GET_LOCK|PROCEDURE)\b|\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b|\b(information_schema|performance_schema|mysql|sys)\s*\./i.test(clean)) return '练习判题不支持写入、系统库或耗时函数。';
  return null;
}
