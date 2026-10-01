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

1. 桌面浏览器输入昵称创建练习空间；Android APK 会自动创建“本机学员”，无需输入昵称。如站点启用了练习码，仍需先输入练习码。
2. 从左侧选择数据库与数据表，或在“数据库管理”中创建自己的数据库。新数据库为空白，不含示例表。
3. 在编辑器中输入 SQL，点击“运行查询”。结果和错误提示显示在编辑器下方。
4. 如需恢复示例数据，使用“重置示例数据库”。此操作只影响默认示例数据库，不影响自建数据库。
5. “闯关练习”提供 8 道基于示例数据的 SQL 题。本地服务会检查练习要求、列名、行数与结果，错误时给出提示；进度与每题草稿保存在当前设备浏览器中。
6. “设置”可切换浅色、深色或跟随系统，调整强调色、SQL 字号、结果密度、自动换行、草稿保存、练习提示、动画和显示名称。

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

## Android 一体 APK（实验版）

`app/` 是 Android 启动器。APK 内含网页版前端、Node 后端源码，以及 ARM64 和 x86_64 的 PRoot 程序。普通构建首次启动时会下载经 SHA-256 校验的 Ubuntu 24.04 基础系统和 Node.js 22，在 PRoot 中安装真正的 MySQL 8.0。ARM64 离线构建预先内置完整环境，手机首次启动只校验、解压和设置本机数据库密码，不运行 APT、dpkg 或 npm。两种构建都会启动仅监听 `127.0.0.1` 的 MySQL 和网页服务，WebView 打开 `http://127.0.0.1:3000`。之后的数据保存在应用私有目录，重新打开应用不会重新安装。卸载应用或清除应用数据会删除练习数据库。

首次下载 Ubuntu 基础系统优先使用阿里云镜像，Node.js 优先使用南京大学镜像，两者都保留官方地址作为下载备选，并校验 SHA-256。APT 默认使用阿里云：ARM64 选择 `ubuntu-ports`，x86_64 选择 `ubuntu`；网页依赖使用 npmmirror。Ubuntu Base 初始环境没有 CA 证书，因此 APT 镜像使用 HTTP 完成首次安装，同时由 Ubuntu 仓库签名和软件包哈希校验内容。手机底栏的“设置”进入个性设置，其中“安装源、网页缩放与运行日志”可切换阿里云、清华大学和 Ubuntu 官方 APT 软件源，并调整网页整体大小。更换软件源会写入现有 Ubuntu 环境，后续安装及更新生效；不会删除练习数据。

普通构建首次启动需要联网，建议使用 Wi-Fi。离线构建首次启动无需下载软件包，但解压期间需要足够存储空间。运行时会显示一条“本地 MySQL 服务”通知。APK 支持 ARM64 手机；仓库附带 x86_64 PRoot，供模拟器调试。Android 版本最低为 8.0（API 26）。目前 APK 的 `targetSdk` 为 28，以允许 PRoot 执行应用私有目录中的 Linux 程序；这是本地安装的实验构建，不适合直接发布到应用商店。

如果首次安装中断，应用会检测未完成的 `dpkg` 状态并尝试恢复。新版启动页会根据安装、存储、网络或 MySQL 错误显示下一步建议；“查看运行日志”可查看和复制最近 16 KB 的 `runtime.log`。升级 APK 不会清除原有应用数据；请勿为了重试直接清除数据。

在装有 Android Studio、JDK 17 和 Android SDK 34 的电脑上构建：

```powershell
# 已包含 PRoot 文件；需要重新获取时运行以下命令
python scripts/prepare_proot.py

.\gradlew.bat assembleDebug
```

可安装的调试包位于 `app/build/outputs/apk/debug/app-debug.apk`。连接手机或模拟器后执行：

```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

离线 ARM64 包的构建方式见 [prebuilt/README.md](prebuilt/README.md)。仓库的 `Build offline ARM64 APK` GitHub Actions 工作流使用 ARM64 Ubuntu 虚拟机预装环境，再把环境嵌入 APK。Android CLI 可管理 SDK、模拟器和安装 APK；在 x86_64 Windows 主机上运行 ARM64 Android 模拟器无法使用虚拟化加速，因此 ARM64 环境构建放在 ARM64 虚拟机中。

已在 Android 14 的 Pixel 8 x86_64 模拟器中验证 APK 安装、首次初始化、创建练习空间、执行 `SELECT VERSION()`（返回 MySQL 8.0.46）和重启后读取原练习空间。也已在 Android 16 的 ARM64 真机上验证在线安装、网页界面、创建练习空间，以及通过应用后端执行 `SELECT VERSION()`（返回 MySQL 8.0.46）。离线 ARM64 构建已在 Android 16 真机上验证首次解压、MySQL 连接检查、网页显示和 `/api/health` 返回 200。PRoot 和依赖库的来源及许可见 [第三方声明](THIRD_PARTY_NOTICES.md)。

## 开源协议

本项目采用 [MIT License](LICENSE)。
