# MySQL Lab

MySQL Lab 是面向课堂练习的网页 SQL 工作台。学生可以在浏览器中编写和运行 MySQL 语句，查看查询结果、表结构，并管理自己的数据库。界面适配桌面和手机浏览器，可通过 Docker Compose 部署。

> MySQL 不提供原生网页管理界面。本项目采用常见数据库客户端的工作台布局，并非 MySQL 官方产品。

## 功能

- **独立练习空间**：首次进入时自动创建专属 MySQL 用户和示例数据库，内含 `students`、`courses`、`enrollments` 三张表。
- **SQL 工作台**：支持多条 MySQL 语句、结果集切换、表结构浏览、示例查询和本地草稿保存。可按 `Ctrl + Enter`，在 macOS 上按 `⌘ + Enter` 运行。
- **数据库管理**：学生可创建最多 9 个额外数据库，并在自己的数据库间切换；管理页可查看表结构与数据、生成建表语句、删除表或数据库。
- **错误提示**：显示 MySQL 错误信息、错误码、可用的行号及中文修改建议。
- **手机适配**：导航栏收进抽屉，查询结果可横向滚动。

学生 SQL 使用其专属 MySQL 账户执行。服务端会校验所选数据库的归属，学生无法通过网页查询其他学生的数据库。

## 快速开始

需要 Docker 和 Docker Compose。克隆仓库后，在项目目录执行：

```bash
cp .env.example .env
# 编辑 .env，为 MYSQL_ROOT_PASSWORD 设置强随机密码
docker compose up -d --build
```

默认访问地址为 `http://localhost:3000`。修改 `.env` 中的 `WEB_PORT` 可调整端口。第一次启动会初始化 MySQL，可能需要稍等片刻。

停止服务：

```bash
docker compose down
```

数据保存在 Docker 卷中。`docker compose down` 会保留数据；`docker compose down -v` 会删除数据库卷及其中的学生数据。

## 通过反向代理部署

公开部署时使用 `compose.public.yaml`。此配置要求设置 `LAB_ACCESS_CODE`，只发布网页端口，MySQL 端口保持在容器网络中。

```bash
cp .env.example .env
# 编辑 .env：设置 MYSQL_ROOT_PASSWORD、LAB_ACCESS_CODE 和 WEB_PORT=28473
docker compose -f compose.public.yaml up -d --build
```

将反向代理的上游指向 `http://服务器局域网IP:28473`，并保留原始 `Host` 请求头。服务器本身无需配置 HTTPS 证书；如果反向代理向浏览器提供 HTTPS，请设置 `COOKIE_SECURE=true`。若浏览器通过 HTTP 访问，则使用 `COOKIE_SECURE=false`。

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `MYSQL_ROOT_PASSWORD` | MySQL 管理密码，必须设置 | 无 |
| `LAB_ACCESS_CODE` | 学生进入练习空间时输入的共享练习码；公开部署必须设置 | 空 |
| `WEB_PORT` | 宿主机网页端口 | 本地配置 `3000`；公开配置 `28473` |
| `COOKIE_SECURE` | 仅通过 HTTPS 发送会话 Cookie | `false` |

## 学生使用说明

1. 输入昵称；如果站点启用了练习码，再输入老师提供的练习码，创建练习空间。
2. 从左侧选择数据库与数据表，或在“数据库管理”中创建自己的数据库。新数据库为空白，不含示例表。
3. 在编辑器中输入 SQL，点击“运行查询”。结果和错误提示显示在编辑器下方。
4. 如需恢复示例数据，使用“重置示例数据库”。此操作只影响默认示例数据库，不影响自建数据库。

数据库实际名称包含学生专属前缀，确保不同学生使用相同的自定义名称时互不冲突。每位学生最多拥有 1 个默认数据库和 9 个自建数据库。单次 SQL 最长 20,000 字符；每个结果集最多显示前 500 行。较大的查询建议使用 `LIMIT`。

## 数据与访问边界

练习空间通过当前浏览器的 Cookie 识别。清除 Cookie 后无法自动找回原空间，重新进入会创建新的空间。`LAB_ACCESS_CODE` 是共享课堂练习码，不等同于学生账号认证。本项目适合课堂与练习环境，目前不提供教师后台、正式身份认证、作业评分或存储配额。

服务端使用管理账户创建数据库和学生账户；管理账户密码保存在部署端的 `.env` 文件中，不写入源码。每位学生的 SQL 使用独立的 MySQL 账户执行，权限仅授予其拥有的数据库。请勿将 MySQL 容器端口直接发布到公网。

## 备份与升级

生产环境更新前，可备份全部 MySQL 数据库：

```bash
docker compose -f compose.public.yaml exec -T db sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --all-databases --single-transaction --routines --triggers' \
  | gzip > mysql-lab-backup.sql.gz
```

拉取新代码后，使用相同的 Compose 文件重新构建并启动。不要删除 `.env` 或数据库卷。应用会在启动时补齐旧学生的数据库归属记录。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `server.js` | HTTP API、学生空间、数据库隔离与 MySQL 查询 |
| `public/` | 网页界面及手机适配样式 |
| `compose.yaml` | 本地 Docker Compose 配置 |
| `compose.public.yaml` | 反向代理场景的 Docker Compose 配置 |
| `.env.example` | 环境变量示例 |

## 开源协议

本项目采用 [MIT License](LICENSE)。
