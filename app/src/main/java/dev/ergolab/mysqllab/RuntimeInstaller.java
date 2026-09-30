package dev.ergolab.mysqllab;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.os.Build;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.FileVisitResult;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

final class RuntimeInstaller {
    private static final String BUNDLED_ARM64_MARKER = "mysql-lab-prebuilt-noble-arm64-v1";
    private static final String ROOTFS_BASE = "https://cdimage.ubuntu.com/ubuntu-base/releases/noble/release/";
    private static final String ROOTFS_MIRROR = "https://mirrors.aliyun.com/ubuntu-cdimage/ubuntu-base/releases/noble/release/";
    private static final String ARM64_SHA256 = "04207713ece899c3740823d33690441ad3a7f0ded1101aca744e2b0f37ac7ff2";
    private static final String AMD64_SHA256 = "c1e67ef7b17a6300e136118bd1dc04725009cb376c1aad10abcf8cd453628d58";
    private static final String NODE_BASE = "https://nodejs.org/dist/v22.16.0/";
    private static final String NODE_MIRROR = "https://mirrors.nju.edu.cn/nodejs-release/v22.16.0/";
    private static final String NODE_ARM64_SHA256 = "1725602e9fb150eb8b8220a899085190e1c04d1a5f3862b01c3dc1dfce0157f9";
    private static final String NODE_X64_SHA256 = "fb870226119d47378fa9c92c4535389c72dae14fcc7b47e6fdcc82c43de5a547";
    private final Context context;
    private final File files;
    private final File rootfs;
    private final File proot;
    private final File statusFile;
    private final File logFile;
    private final File passwordFile;
    private final String rootfsName;
    private final String rootfsSha256;
    private final String nodeName;
    private final String nodeSha256;
    private final boolean arm64;
    private final List<Process> running = new ArrayList<>();

    RuntimeInstaller(Context context) {
        this.context = context;
        files = context.getFilesDir();
        rootfs = new File(files, "ubuntu");
        proot = new File(context.getApplicationInfo().nativeLibraryDir, "libproot.so");
        statusFile = context.getFileStreamPath("runtime-status.txt");
        logFile = context.getFileStreamPath("runtime.log");
        passwordFile = new File(files, "mysql-password");
        arm64 = Build.SUPPORTED_ABIS.length > 0 && "arm64-v8a".equals(Build.SUPPORTED_ABIS[0]);
        rootfsName = "ubuntu-base-24.04.4-base-" + (arm64 ? "arm64" : "amd64") + ".tar.gz";
        rootfsSha256 = arm64 ? ARM64_SHA256 : AMD64_SHA256;
        nodeName = "node-v22.16.0-linux-" + (arm64 ? "arm64" : "x64");
        nodeSha256 = arm64 ? NODE_ARM64_SHA256 : NODE_X64_SHA256;
    }

    void start() throws Exception {
        if (Build.SUPPORTED_ABIS.length == 0 ||
                !("arm64-v8a".equals(Build.SUPPORTED_ABIS[0]) || "x86_64".equals(Build.SUPPORTED_ABIS[0]))) {
            status("此设备需要 ARM64 或 x86_64 处理器。");
            return;
        }
        if (!proot.isFile()) throw new IllegalStateException("APK 缺少 ARM64 PRoot 运行文件");
        installRootfs();
        updateResolvConf();
        configureAptSources(context);
        copySite();
        if (!new File(files, "installed-v1").isFile()) installPackages();
        configureRootPassword();
        status("正在启动 MySQL…");
        Process mysql = spawn("/usr/sbin/mysqld", "--user=root", "--datadir=/var/lib/mysql",
                "--socket=/tmp/mysql-lab.sock", "--port=3306", "--bind-address=127.0.0.1",
                "--skip-name-resolve", "--pid-file=/tmp/mysql-lab.pid", "--log-error=/tmp/mysql-lab.log");
        running.add(mysql);
        waitForMysql("/tmp/mysql-lab.sock");
        runGuest("/usr/bin/mysql", "--protocol=tcp", "--host=127.0.0.1", "-uroot",
                "--password=" + readText(passwordFile).trim(), "-N", "-B", "-e", "SELECT 1");
        status("正在启动网页服务…");
        Process web = spawnWithEnvironment(new String[]{"PORT=3000", "LISTEN_HOST=127.0.0.1",
                        "MYSQL_HOST=127.0.0.1", "MYSQL_ROOT_PASSWORD=" + readText(passwordFile).trim(),
                        "NODE_ENV=production"}, "/opt/" + nodeName + "/bin/node", "/opt/mysql-lab/server.js");
        running.add(web);
        status("本地服务已启动");
        int exit = web.waitFor();
        status("网页服务已退出（代码 " + exit + "）；请重试启动");
    }

    private void installRootfs() throws Exception {
        File marker = new File(rootfs, ".mysql-lab-rootfs-ready");
        if (marker.isFile()) {
            String installed = readText(marker).trim();
            if (installed.equals(rootfsName)) {
                File mysqlData = new File(rootfs, "var/lib/mysql");
                String[] entries = mysqlData.list();
                if (arm64 && bundledRuntimeAvailable() &&
                        !new File(files, "installed-v1").isFile() &&
                        (entries == null || entries.length == 0)) {
                    status("正在修复上次未完成的在线安装…");
                    deleteTree(rootfs.toPath());
                    installBundledRuntime(marker);
                }
                return;
            }
            if (arm64 && installed.equals(BUNDLED_ARM64_MARKER)) {
                verifyBundledRuntime();
                writeText(new File(files, "installed-v1"), "bundled\n");
                return;
            }
            throw new IllegalStateException("现有 Ubuntu 系统与设备架构不符；请清除应用数据后重试");
        }
        if (arm64 && bundledRuntimeAvailable()) {
            installBundledRuntime(marker);
            return;
        }
        status("正在下载 Ubuntu 基础系统（约 28 MB）…");
        File archive = new File(files, "ubuntu-base.tar.gz");
        if (!archive.isFile() || !sha256(archive).equals(rootfsSha256)) {
            if (archive.exists() && !archive.delete()) throw new IllegalStateException("无法替换损坏的系统包");
            downloadWithFallback(archive, rootfsName, ROOTFS_MIRROR, ROOTFS_BASE, rootfsSha256);
            if (!sha256(archive).equals(rootfsSha256)) throw new IllegalStateException("Ubuntu 包校验失败");
        }
        status("正在解压 Ubuntu 基础系统…");
        if (!rootfs.isDirectory() && !rootfs.mkdirs()) throw new IllegalStateException("无法创建系统目录");
        TarExtractor.extract(archive, rootfs);
        if (!new File(rootfs, "tmp").isDirectory()) new File(rootfs, "tmp").mkdirs();
        writeText(marker, rootfsName + "\n");
        archive.delete();
    }

    private boolean bundledRuntimeAvailable() throws Exception {
        try (InputStream ignored = context.getAssets().open("runtime/arm64-rootfs.sha256")) {
            return true;
        } catch (FileNotFoundException missing) {
            return false;
        }
    }

    private static void deleteTree(Path path) throws Exception {
        Files.walkFileTree(path, new SimpleFileVisitor<Path>() {
            @Override public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) throws java.io.IOException {
                Files.delete(file);
                return FileVisitResult.CONTINUE;
            }
            @Override public FileVisitResult postVisitDirectory(Path directory, java.io.IOException error) throws java.io.IOException {
                if (error != null) throw error;
                Files.delete(directory);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private void installBundledRuntime(File marker) throws Exception {
        String expected;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                context.getAssets().open("runtime/arm64-rootfs.sha256"), StandardCharsets.US_ASCII))) {
            String line = reader.readLine();
            expected = line == null ? "" : line.trim();
        }
        if (!expected.matches("[0-9a-f]{64}")) throw new IllegalStateException("APK 中的 ARM64 环境校验值无效");
        status("正在释放内置 ARM64 环境…");
        File archive = new File(files, "prebuilt-arm64-rootfs.tar.gz");
        if (!archive.isFile() || !sha256(archive).equals(expected)) {
            if (archive.exists() && !archive.delete()) throw new IllegalStateException("无法替换损坏的内置环境包");
            try (InputStream input = context.getAssets().open("runtime/arm64-rootfs.tar.gz");
                 FileOutputStream output = new FileOutputStream(archive)) {
                byte[] buffer = new byte[65536];
                int n;
                while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
            }
            if (!sha256(archive).equals(expected)) throw new IllegalStateException("内置 ARM64 环境校验失败");
        }
        status("正在解压内置 Ubuntu、MySQL 和 Node 环境…");
        if (!rootfs.isDirectory() && !rootfs.mkdirs()) throw new IllegalStateException("无法创建系统目录");
        TarExtractor.extract(archive, rootfs);
        verifyBundledRuntime();
        writeText(new File(files, "installed-v1"), "bundled\n");
        writeText(marker, BUNDLED_ARM64_MARKER + "\n");
        archive.delete();
    }

    private void verifyBundledRuntime() {
        if (!new File(rootfs, "usr/sbin/mysqld").isFile() ||
                !new File(rootfs, "opt/" + nodeName + "/bin/node").isFile() ||
                !new File(rootfs, "opt/mysql-lab/node_modules/mysql2").isDirectory() ||
                !new File(rootfs, "var/lib/mysql/mysql").isDirectory()) {
            throw new IllegalStateException("内置 ARM64 环境不完整；请重新安装 APK 后重试");
        }
    }

    private void updateResolvConf() throws Exception {
        StringBuilder nameservers = new StringBuilder();
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager != null) {
            Network network = manager.getActiveNetwork();
            LinkProperties properties = network == null ? null : manager.getLinkProperties(network);
            if (properties != null) {
                for (InetAddress address : properties.getDnsServers()) {
                    nameservers.append("nameserver ").append(address.getHostAddress()).append('\n');
                }
            }
        }
        if (nameservers.length() == 0) nameservers.append("nameserver 1.1.1.1\n");
        writeText(new File(rootfs, "etc/resolv.conf"), nameservers.toString());
    }

    static void configureAptSources(Context context) throws Exception {
        File ubuntu = new File(context.getFilesDir(), "ubuntu");
        if (!ubuntu.isDirectory()) return;
        boolean arm64 = Build.SUPPORTED_ABIS.length > 0 && "arm64-v8a".equals(Build.SUPPORTED_ABIS[0]);
        String path = arm64 ? "ubuntu-ports" : "ubuntu";
        String selected = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
                .getString("apt_mirror", "aliyun");
        String host;
        // Ubuntu Base does not contain ca-certificates yet. APT verifies the signed
        // Release file and package hashes, so HTTP can safely bootstrap packages.
        if ("tuna".equals(selected)) host = "http://mirrors.tuna.tsinghua.edu.cn/";
        else if ("official".equals(selected)) host = arm64 ? "http://ports.ubuntu.com/" : "http://archive.ubuntu.com/";
        else host = "http://mirrors.aliyun.com/";
        String uri = host + path + "/";
        String signedBy = "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
        String sources = "Types: deb\nURIs: " + uri + "\nSuites: noble noble-updates noble-backports\n" +
                "Components: main restricted universe multiverse\n" + signedBy + "\n" +
                "Types: deb\nURIs: " + uri + "\nSuites: noble-security\n" +
                "Components: main restricted universe multiverse\n" + signedBy;
        File sourceDir = new File(ubuntu, "etc/apt/sources.list.d");
        if (!sourceDir.isDirectory() && !sourceDir.mkdirs()) throw new IllegalStateException("无法创建软件源目录");
        writeText(new File(ubuntu, "etc/apt/sources.list"), "# Managed by MySQL Lab\n");
        writeText(new File(sourceDir, "ubuntu.sources"), sources);
    }

    private void copySite() throws Exception {
        File site = new File(rootfs, "opt/mysql-lab");
        copyAssetTree("site", site);
    }

    private void copyAssetTree(String assetPath, File target) throws Exception {
        String[] children = context.getAssets().list(assetPath);
        if (children != null && children.length > 0) {
            if (!target.isDirectory() && !target.mkdirs()) throw new IllegalStateException("无法创建目录 " + target);
            for (String child : children) copyAssetTree(assetPath + "/" + child, new File(target, child));
        } else {
            File parent = target.getParentFile();
            if (!parent.isDirectory() && !parent.mkdirs()) throw new IllegalStateException("无法创建目录 " + parent);
            try (InputStream input = context.getAssets().open(assetPath); FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[8192]; int n;
                while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
            }
        }
    }

    private void installPackages() throws Exception {
        // Ubuntu Base has no unfinished package transactions. Only recover dpkg
        // after an interrupted install; running it unconditionally can fail on
        // some Android/PRoot combinations before APT has installed anything.
        if (hasPendingDpkgConfiguration()) {
            status("正在恢复上次中断的软件包安装…");
            try {
                runGuest("/usr/bin/env", "DEBIAN_FRONTEND=noninteractive", "/usr/bin/dpkg", "--configure", "-a");
            } catch (Exception error) {
                throw new IllegalStateException("软件包恢复失败；点击“查看安装日志”了解原因", error);
            }
        }
        status("正在更新 Ubuntu 软件索引…");
        runGuest("/usr/bin/apt-get", "update", "-o", "APT::Update::Error-Mode=any");
        status("正在安装 MySQL（首次启动可能较久）…");
        try {
            runGuest("/usr/bin/env", "DEBIAN_FRONTEND=noninteractive", "/usr/bin/apt-get", "install", "-y", "--no-install-recommends", "mysql-server");
        } catch (Exception error) {
            throw new IllegalStateException("MySQL 软件包安装失败；请检查软件源和 runtime.log", error);
        }
        installNode();
        status("正在安装网页服务依赖…");
        File lockfile = new File(rootfs, "opt/mysql-lab/package-lock.json");
        writeText(lockfile, readText(lockfile).replace("https://registry.npmjs.org/", "https://registry.npmmirror.com/"));
        runGuest("/bin/sh", "-c", "cd /opt/mysql-lab && npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com");
        File marker = new File(files, "installed-v1");
        writeText(marker, "ok\n");
    }

    private boolean hasPendingDpkgConfiguration() throws Exception {
        File updates = new File(rootfs, "var/lib/dpkg/updates");
        String[] pendingUpdates = updates.list((directory, name) -> name.matches("[0-9]+"));
        if (pendingUpdates != null && pendingUpdates.length > 0) return true;
        File status = new File(rootfs, "var/lib/dpkg/status");
        if (!status.isFile()) return false;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(status), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("Status: ") && (line.endsWith(" unpacked") ||
                        line.endsWith(" half-configured") || line.endsWith(" half-installed") ||
                        line.endsWith(" triggers-awaited") || line.endsWith(" triggers-pending"))) return true;
            }
        }
        return false;
    }

    private void installNode() throws Exception {
        File nodeHome = new File(rootfs, "opt/" + nodeName);
        File marker = new File(nodeHome, ".mysql-lab-node-ready");
        if (marker.isFile()) return;
        status("正在下载官方 Node.js 22…");
        String archiveName = nodeName + ".tar.gz";
        File archive = new File(files, archiveName);
        if (!archive.isFile() || !sha256(archive).equals(nodeSha256)) {
            if (archive.exists() && !archive.delete()) throw new IllegalStateException("无法替换 Node.js 包");
            downloadWithFallback(archive, archiveName, NODE_MIRROR, NODE_BASE, nodeSha256);
            if (!sha256(archive).equals(nodeSha256)) throw new IllegalStateException("Node.js 包校验失败");
        }
        status("正在解压 Node.js 22…");
        TarExtractor.extract(archive, new File(rootfs, "opt"));
        writeText(marker, nodeName + "\n");
        archive.delete();
    }

    private void waitForMysql(String socket) throws Exception {
        for (int attempt = 0; attempt < 60; attempt++) {
            Process check = spawn("/usr/bin/mysqladmin", "--protocol=socket", "--socket=" + socket, "ping");
            if (check.waitFor() == 0) return;
            Thread.sleep(1000);
        }
        throw new IllegalStateException("MySQL 未能启动；查看 runtime.log 与 Ubuntu /tmp/mysql-lab.log");
    }

    private void configureRootPassword() throws Exception {
        File marker = new File(files, "mysql-root-configured");
        if (marker.isFile()) return;
        status("正在初始化 MySQL 管理账户…");
        if (!passwordFile.isFile()) {
            byte[] random = new byte[24];
            new SecureRandom().nextBytes(random);
            StringBuilder secret = new StringBuilder();
            for (byte b : random) secret.append(String.format("%02x", b & 0xff));
            writeText(passwordFile, secret.toString());
        }
        String password = readText(passwordFile).trim();
        Process bootstrap = spawn("/usr/sbin/mysqld", "--user=root", "--datadir=/var/lib/mysql",
                "--skip-grant-tables", "--skip-networking", "--socket=/tmp/mysql-bootstrap.sock",
                "--pid-file=/tmp/mysql-bootstrap.pid", "--log-error=/tmp/mysql-bootstrap.log");
        try {
            waitForMysql("/tmp/mysql-bootstrap.sock");
            runGuest("/usr/bin/mysql", "--protocol=socket", "--socket=/tmp/mysql-bootstrap.sock", "-uroot", "-e",
                    "FLUSH PRIVILEGES; " +
                    "ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY '" + password + "'; " +
                    "CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED WITH caching_sha2_password BY '" + password + "'; " +
                    "GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;");
            runGuest("/usr/bin/mysqladmin", "--protocol=socket", "--socket=/tmp/mysql-bootstrap.sock",
                    "-uroot", "--password=" + password, "shutdown");
            bootstrap.waitFor();
            writeText(marker, "ok\n");
        } finally {
            if (bootstrap.isAlive()) {
                File pidFile = new File(rootfs, "tmp/mysql-bootstrap.pid");
                try { android.os.Process.killProcess(Integer.parseInt(readText(pidFile).trim())); }
                catch (Exception ignored) { }
                bootstrap.destroy();
            }
        }
    }

    private Process spawn(String... command) throws Exception { return spawnWithEnvironment(new String[0], command); }

    private Process spawnWithEnvironment(String[] extraEnvironment, String... command) throws Exception {
        List<String> args = new ArrayList<>();
        args.add(proot.getAbsolutePath());
        args.addAll(Arrays.asList("-0", "-L", "--link2symlink", "--sysvipc", "-r", rootfs.getAbsolutePath(), "-b", "/dev", "-b", "/proc", "-b", "/sys", "-w", "/root"));
        args.add("/usr/bin/env"); args.add("-i");
        args.addAll(Arrays.asList("HOME=/root", "PATH=/opt/" + nodeName + "/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C.UTF-8"));
        args.addAll(Arrays.asList(extraEnvironment));
        args.addAll(Arrays.asList(command));
        ProcessBuilder builder = new ProcessBuilder(args);
        builder.environment().put("LD_LIBRARY_PATH", context.getApplicationInfo().nativeLibraryDir);
        File prootTmp = new File(files, "proot-tmp");
        if (!prootTmp.isDirectory() && !prootTmp.mkdirs()) throw new IllegalStateException("无法创建 PRoot 临时目录");
        builder.environment().put("PROOT_TMP_DIR", prootTmp.getAbsolutePath());
        builder.environment().put("PROOT_LOADER", new File(context.getApplicationInfo().nativeLibraryDir,
                "libproot-loader.so").getAbsolutePath());
        File links = new File(rootfs, ".l2s");
        if (!links.isDirectory() && !links.mkdirs()) throw new IllegalStateException("无法创建 PRoot 链接目录");
        builder.environment().put("PROOT_L2S_DIR", links.getAbsolutePath());
        builder.redirectErrorStream(true);
        Process process = builder.start();
        new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    synchronized (logFile) {
                        try (FileOutputStream output = new FileOutputStream(logFile, true)) {
                            output.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                        }
                    }
                }
            } catch (Exception ignored) { }
        }, "proot-output").start();
        return process;
    }

    private void runGuest(String... command) throws Exception {
        Process process = spawn(command);
        int code = process.waitFor();
        if (code != 0) throw new IllegalStateException(command[0] + " 退出代码 " + code + "；详见 runtime.log");
    }

    private void runHost(String... command) throws Exception {
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        int code = process.waitFor();
        if (code != 0) throw new IllegalStateException(command[0] + " 退出代码 " + code);
    }

    private void status(String message) throws Exception {
        writeText(statusFile, message);
    }

    private static void writeText(File file, String value) throws Exception {
        Files.write(file.toPath(), value.getBytes(StandardCharsets.UTF_8));
    }

    private static String readText(File file) throws Exception {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    private void downloadWithFallback(File archive, String name, String mirror, String official, String expectedSha) throws Exception {
        Exception failure = null;
        for (String base : new String[]{mirror, official}) {
            if (archive.exists() && !archive.delete()) throw new IllegalStateException("无法替换下载文件");
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(base + name).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                try {
                    if (connection.getResponseCode() != 200) throw new IllegalStateException("HTTP " + connection.getResponseCode());
                    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(archive)) {
                        byte[] buffer = new byte[65536]; int n;
                        while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                    }
                } finally { connection.disconnect(); }
                if (!sha256(archive).equals(expectedSha)) throw new IllegalStateException("SHA-256 校验失败");
                return;
            } catch (Exception error) { failure = error; }
        }
        throw new IllegalStateException("镜像和官方地址均无法下载 " + name, failure);
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int n;
            while ((n = input.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format("%02x", b & 0xff));
        return hex.toString();
    }
}
