# MySQL Lab

供学生练习的 MySQL 网页工作台。界面参考常见数据库客户端的布局，支持手机浏览器。每个浏览器首次进入时会得到独立的 MySQL 数据库，预置 `students`、`courses` 和 `enrollments` 三张示例表。

## Docker 部署

1. 复制配置：`cp .env.example .env`
2. 修改 `.env`，设置强随机的 `MYSQL_ROOT_PASSWORD`。如果站点对外开放，也设置 `LAB_ACCESS_CODE`，把练习码发给学生。
3. 启动：`docker compose up -d --build`
4. 打开 `http://localhost:3000`。可通过 `WEB_PORT` 修改端口。

停止服务：`docker compose down`。数据库保存在 Docker 卷 `mysql_data` 中；不要使用 `docker compose down -v`，除非确定要删除所有学生数据。

建议通过 HTTPS 反向代理公开网站，并将 `COOKIE_SECURE=true`。不要把 MySQL 容器端口直接暴露到公网。

### 在 zhuhome.top 公开部署

项目包含 [compose.public.yaml](compose.public.yaml) 和 [Caddyfile](Caddyfile)。设置好 `.env` 中的 `MYSQL_ROOT_PASSWORD` 与 `LAB_ACCESS_CODE` 后运行：

```bash
docker compose -f compose.public.yaml up -d --build
```

此配置在主机上监听 80/443，Caddy 自动为 `zhuhome.top` 申请 HTTPS 证书；网页与 MySQL 不直接发布端口。需要域名指向该服务器且外部网络允许访问 80/443，证书才能成功签发。

## 使用方式

- 输入昵称后创建个人练习空间。设置了 `LAB_ACCESS_CODE` 时还需输入练习码。
- 点击左侧数据表查看字段；双击表名生成 `SELECT` 查询。
- 点击“运行查询”或按 `Ctrl + Enter`（Mac 为 `⌘ + Enter`）执行 SQL。支持多条语句，结果按页签显示。
- 左侧“快速开始”提供查询、连接和分组示例。编辑器草稿保存在浏览器本地。
- “重置示例数据库”可删除个人空间中的改动，恢复初始示例表。
- 查询结果最多显示 500 行；大查询请使用 `LIMIT`。单次 SQL 最长 20,000 字符。

练习空间通过浏览器 Cookie 识别。清除 Cookie 后不能自动找回原数据库，重新进入会创建新的空间。这个版本适合课堂和练习环境，没有教师账号、正式学生认证或作业评分功能。

## 技术说明

`web` 是 Node.js 服务，`db` 使用 MySQL 8.4。服务端用管理账户创建学生数据库及专属 MySQL 用户；学生 SQL 仅用其专属账户执行，权限限定在该学生数据库中。MySQL 本身没有自带的网页 UI，因此这里采用数据库工作台风格，而不是声称复刻不存在的原生界面。
