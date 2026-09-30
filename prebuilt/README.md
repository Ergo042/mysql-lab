# ARM64 离线环境包

在 Ubuntu 24.04 ARM64 虚拟机上运行 `bash scripts/build_arm64_bundle.sh`，生成 `arm64-rootfs.tar.gz` 与 `arm64-rootfs.sha256`。脚本预装 Ubuntu、MySQL、Node 和网页依赖，默认使用阿里云 Ubuntu 镜像、南京大学 Node 镜像和 npmmirror。可用 `UBUNTU_ARM64_MIRROR` 修改构建时的 Ubuntu 镜像。Gradle 构建 APK 时会自动纳入这两个文件。

将代码推送到 `android-offline-arm64` 分支会启动 `Build offline ARM64 APK` 工作流；合并到默认分支后也可在 GitHub Actions 中手动运行。它先在 ARM64 虚拟机中构建环境，再在 x86_64 构建机中生成 `mysql-lab-offline-arm64-fresh-install-debug` APK。需要仓库启用 Actions，且托管 ARM64 runner 可用。这个 APK 使用虚拟机临时生成的调试密钥，适合全新安装；首次启动不执行 APT、dpkg 或 npm。

如果手机上已安装本机先前构建的 APK，应下载工作流的 `arm64-rootfs` 环境包并解压至本目录，再在原构建电脑上运行 `./gradlew assembleDebug -PrequireArm64Bundle`。这样继续使用本机原有的调试签名，可通过 `adb install -r` 升级并保留应用数据。请勿为了安装虚拟机生成的 APK 而卸载已有应用，卸载会删除练习数据。

本地已有环境包时，使用 `./gradlew assembleDebug -PrequireArm64Bundle` 构建。这个参数会在环境包缺失时中止构建，避免误把在线安装版标为离线版。

未提供环境包时仍可构建小体积在线安装 APK。已安装的练习数据在升级 APK 后继续使用原有应用私有目录，不会被环境包覆盖。离线环境仅用于全新安装；已有在线环境的应用继续使用原数据与系统。
