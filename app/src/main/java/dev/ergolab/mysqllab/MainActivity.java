package dev.ergolab.mysqllab;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.system.Os;
import android.system.OsConstants;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.net.HttpURLConnection;
import java.net.URL;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private TextView status;
    private ProgressBar spinner;
    private LinearLayout loading;
    private ScrollView loadingContainer;
    private TextView loadingAdvice;
    private boolean pageOpened;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        applySystemTheme();
        boolean dark = isDarkTheme();
        int foreground = dark ? 0xffe5edfa : 0xff182438;
        int secondary = dark ? 0xffa9bad1 : 0xff70829a;
        int card = dark ? 0xff1b2b45 : 0xffffffff;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(dark ? 0xff101827 : 0xfff5f7fb);
        loadingContainer = new ScrollView(this);
        loadingContainer.setFillViewport(true);
        loading = new LinearLayout(this);
        loading.setOrientation(LinearLayout.VERTICAL);
        loading.setPadding(dp(23), dp(42), dp(23), dp(30));
        loading.setGravity(Gravity.CENTER_HORIZONTAL | Gravity.CENTER_VERTICAL);
        TextView eyebrow = new TextView(this);
        eyebrow.setText("◈  YOUR POCKET DATABASE");
        eyebrow.setTextColor(dark ? 0xff9bc2ff : 0xff3973cd);
        eyebrow.setTextSize(11);
        eyebrow.setTypeface(null, Typeface.BOLD);
        eyebrow.setLetterSpacing(0.15f);
        loading.addView(eyebrow);
        TextView title = new TextView(this);
        title.setText("MySQL Lab");
        title.setTextSize(35);
        title.setTypeface(null, Typeface.BOLD);
        title.setTextColor(foreground);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(-2, -2);
        titleParams.topMargin = dp(10);
        loading.addView(title, titleParams);
        TextView subtitle = new TextView(this);
        subtitle.setText("一间装在手机里的 SQL 实验室");
        subtitle.setTextColor(secondary);
        subtitle.setTextSize(14);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(-2, -2);
        subtitleParams.topMargin = dp(6);
        loading.addView(subtitle, subtitleParams);
        LinearLayout cardView = new LinearLayout(this);
        cardView.setOrientation(LinearLayout.VERTICAL);
        cardView.setPadding(dp(20), dp(23), dp(20), dp(23));
        cardView.setBackground(roundRect(card, dark ? 0xff314560 : 0xffe1e9f4, 20));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(-1, -2);
        cardParams.topMargin = dp(35);
        loading.addView(cardView, cardParams);
        TextView cardEyebrow = new TextView(this);
        cardEyebrow.setText("●  本地环境准备中");
        cardEyebrow.setTextColor(0xff5d9df5);
        cardEyebrow.setTextSize(12);
        cardEyebrow.setTypeface(null, Typeface.BOLD);
        cardView.addView(cardEyebrow);
        spinner = new ProgressBar(this);
        LinearLayout.LayoutParams spinParams = new LinearLayout.LayoutParams(dp(40), dp(40));
        spinParams.topMargin = dp(23);
        spinParams.gravity = Gravity.CENTER_HORIZONTAL;
        cardView.addView(spinner, spinParams);
        status = new TextView(this);
        status.setTextSize(16);
        status.setTypeface(null, Typeface.BOLD);
        status.setTextColor(foreground);
        status.setGravity(Gravity.CENTER);
        status.setText("正在准备本地服务…");
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(17);
        cardView.addView(status, statusParams);
        TextView detail = new TextView(this);
        boolean bundledArm64 = false;
        try {
            for (String asset : getAssets().list("runtime")) {
                if ("arm64-rootfs.bin".equals(asset)) bundledArm64 = true;
            }
        } catch (Exception ignored) { }
        detail.setText(bundledArm64
                ? "首次启动会释放 APK 内置的 Ubuntu、MySQL 和网页服务，无需下载软件包。\n请预留存储空间；练习数据会保存在本机。"
                : "首次启动将配置 Ubuntu、MySQL 和本地网页服务。请保持网络连接。\n安装完成后，练习数据会保存在本机。");
        detail.setTextColor(secondary);
        detail.setTextSize(12);
        detail.setGravity(Gravity.CENTER);
        detail.setLineSpacing(dp(5), 1f);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(-1, -2);
        detailParams.topMargin = dp(14);
        cardView.addView(detail, detailParams);
        loadingAdvice = new TextView(this);
        loadingAdvice.setText("环境就绪后会自动进入工作台，随后可在「闯关」中练习 SQL。");
        loadingAdvice.setTextColor(secondary);
        loadingAdvice.setTextSize(12);
        loadingAdvice.setGravity(Gravity.CENTER);
        loadingAdvice.setLineSpacing(dp(4), 1f);
        LinearLayout.LayoutParams adviceParams = new LinearLayout.LayoutParams(-1, -2);
        adviceParams.topMargin = dp(20);
        loading.addView(loadingAdvice, adviceParams);
        Button retry = new Button(this);
        retry.setText("↻  重试启动");
        retry.setOnClickListener(v -> {
            spinner.setVisibility(View.VISIBLE);
            status.setText("正在重试启动…");
            startService(new Intent(this, RuntimeService.class));
        });
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(-1, dp(48));
        actionParams.topMargin = dp(25);
        retry.setAllCaps(false);
        retry.setTextColor(0xffffffff);
        retry.setBackground(roundRect(0xff176eeb, 0xff176eeb, 12));
        loading.addView(retry, actionParams);
        Button settings = new Button(this);
        settings.setText("运行环境设置");
        settings.setOnClickListener(v -> showSettings());
        styleSecondaryButton(settings, dark);
        loading.addView(settings, secondaryParams());
        Button logs = new Button(this);
        logs.setText("查看诊断日志");
        logs.setOnClickListener(v -> showInstallLog());
        styleSecondaryButton(logs, dark);
        loading.addView(logs, secondaryParams());
        loadingContainer.addView(loading);
        root.addView(loadingContainer, new LinearLayout.LayoutParams(-1, -1));
        webView = new WebView(this);
        webView.setVisibility(View.GONE);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.addJavascriptInterface(new AppBridge(this), "Android");
        applyTextZoom();
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !("http".equals(request.getUrl().getScheme()) &&
                        "127.0.0.1".equals(request.getUrl().getHost()) &&
                        request.getUrl().getPort() == 3000);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        root.addView(webView, new LinearLayout.LayoutParams(-1, -1));
        setContentView(root);
        startService(new Intent(this, RuntimeService.class));
        poll();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private GradientDrawable roundRect(int fill, int stroke, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(radius));
        shape.setStroke(dp(1), stroke);
        return shape;
    }
    private LinearLayout.LayoutParams secondaryParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(48));
        params.topMargin = dp(9);
        return params;
    }
    private void styleSecondaryButton(Button button, boolean dark) {
        button.setAllCaps(false);
        button.setTextColor(dark ? 0xffdbe7f7 : 0xff354e71);
        button.setBackground(roundRect(dark ? 0xff1b2b45 : 0xffffffff, dark ? 0xff32465f : 0xffe0e8f3, 12));
    }
    private String startupAdvice(String message) {
        if (!message.startsWith("启动失败：")) return "环境就绪后会自动进入工作台，随后可在「闯关」中练习 SQL。";
        String lower = message.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("proot") || lower.contains("signal 11")) return "PRoot 进程异常退出。打开「运行环境设置 → PRoot 兼容模式」切换模式并重试；请复制诊断日志反馈。";
        if (lower.contains("space") || lower.contains("空间") || lower.contains("磁盘")) return "存储空间可能不足。清理部分空间后点击重试，并保留安装日志用于定位。";
        if (lower.contains("dpkg") || lower.contains("apt")) return "软件包配置失败。可在运行环境设置中更换大陆镜像，然后点击重试；日志有具体原因。";
        if (lower.contains("mysql")) return "MySQL 未能启动。请查看运行日志，确认安装完整后再重试。";
        if (lower.contains("download") || lower.contains("网络")) return "下载中断。检查网络连接，或切换软件源后重试。";
        return "可先重试；若问题持续，请打开运行日志并检查剩余存储空间。";
    }
    private boolean isDarkTheme() {
        String mode = getSharedPreferences("settings", MODE_PRIVATE).getString("theme_mode", "system");
        return "dark".equals(mode) || ("system".equals(mode) && (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES);
    }
    private void applySystemTheme() {
        boolean dark = isDarkTheme();
        getWindow().setStatusBarColor(dark ? 0xff101827 : 0xfff7f9fd);
        getWindow().setNavigationBarColor(dark ? 0xff101827 : 0xfff7f9fd);
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }

    public static final class AppBridge {
        private final MainActivity activity;
        public AppBridge(MainActivity activity) { this.activity = activity; }
        @JavascriptInterface public void openSettings() {
            activity.runOnUiThread(activity::showSettings);
        }
        @JavascriptInterface public void setThemeMode(String mode) {
            if (!"light".equals(mode) && !"dark".equals(mode) && !"system".equals(mode)) return;
            activity.getSharedPreferences("settings", Activity.MODE_PRIVATE).edit().putString("theme_mode", mode).apply();
            activity.runOnUiThread(activity::applySystemTheme);
        }
    }

    private void applyTextZoom() {
        webView.getSettings().setTextZoom(getPreferences(MODE_PRIVATE).getInt("text_zoom", 115));
    }

    private void showSettings() {
        String[] mirrors = {"阿里云镜像（默认）", "清华大学镜像", "Ubuntu 官方源"};
        String[] values = {"aliyun", "tuna", "official"};
        String selected = getSharedPreferences("settings", MODE_PRIVATE).getString("apt_mirror", "aliyun");
        int current = 0;
        for (int i = 0; i < values.length; i++) if (values[i].equals(selected)) current = i;
        new AlertDialog.Builder(this)
                .setTitle("软件源")
                .setSingleChoiceItems(mirrors, current, (dialog, which) -> {
                    getSharedPreferences("settings", MODE_PRIVATE).edit().putString("apt_mirror", values[which]).apply();
                    try {
                        RuntimeInstaller.configureAptSources(this);
                        Toast.makeText(this, "软件源已保存，后续安装和更新将使用此地址", Toast.LENGTH_LONG).show();
                    } catch (Exception error) {
                        Toast.makeText(this, "保存软件源失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
                    }
                    dialog.dismiss();
                    showDisplaySettings();
                })
                .setNeutralButton("显示设置", (dialog, which) -> showDisplaySettings())
                .setPositiveButton("PRoot 兼容模式", (dialog, which) -> showProotSettings())
                .setNegativeButton("关闭", null)
                .show();
    }

    private void showProotSettings() {
        String[] values = {"auto", "standard", "no_sysvipc", "no_seccomp", "no_sysvipc_no_seccomp"};
        String[] labels = {
                "自动探测基础命令（默认）",
                "标准模式",
                "兼容模式 A · 关闭 SysV IPC",
                "兼容模式 B · 关闭 seccomp 加速",
                "兼容模式 C · 同时关闭两项"
        };
        String selected = getSharedPreferences("settings", MODE_PRIVATE).getString("proot_mode", "auto");
        int current = 0;
        for (int i = 0; i < values.length; i++) if (values[i].equals(selected)) current = i;
        new AlertDialog.Builder(this)
                .setTitle("PRoot 兼容模式")
                .setSingleChoiceItems(labels, current, (dialog, which) -> {
                    getSharedPreferences("settings", MODE_PRIVATE).edit().putString("proot_mode", values[which]).apply();
                    Toast.makeText(this, "已保存；启动失败页点击“重试启动”或重新打开应用后生效", Toast.LENGTH_LONG).show();
                    dialog.dismiss();
                })
                .setNegativeButton("关闭", null)
                .show();
    }

    private void showDisplaySettings() {
        int[] sizes = {100, 115, 130};
        String[] labels = {"标准", "舒适（默认）", "大字"};
        int saved = getPreferences(MODE_PRIVATE).getInt("text_zoom", 115);
        int checked = saved == 100 ? 0 : saved == 130 ? 2 : 1;
        new AlertDialog.Builder(this)
                .setTitle("文字大小")
                .setSingleChoiceItems(labels, checked, (dialog, which) -> {
                    getPreferences(MODE_PRIVATE).edit().putInt("text_zoom", sizes[which]).apply();
                    applyTextZoom();
                    dialog.dismiss();
                })
                .setNeutralButton("软件源", (dialog, which) -> showSettings())
                .setNegativeButton("关闭", null)
                .show();
    }

    private String tail(File file, int limit) {
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            long start = Math.max(0, input.length() - limit);
            input.seek(start);
            byte[] bytes = new byte[(int) (input.length() - start)];
            input.readFully(bytes);
            return (start > 0 ? "…仅显示最后 " + limit / 1024 + " KB…\n" : "") + new String(bytes, StandardCharsets.UTF_8);
        } catch (Exception error) { return "暂无日志（" + error.getClass().getSimpleName() + "）"; }
    }

    private void showInstallLog() {
        String pageSize;
        try { pageSize = String.valueOf(Os.sysconf(OsConstants._SC_PAGESIZE)); }
        catch (Exception error) { pageSize = "未知"; }
        String log = "设备：" + Build.MANUFACTURER + " " + Build.MODEL + "\nAndroid：" + Build.VERSION.RELEASE +
                "（API " + Build.VERSION.SDK_INT + "）\nABI：" + java.util.Arrays.toString(Build.SUPPORTED_ABIS) +
                "\n内存页：" + pageSize + " bytes\nPRoot 模式：" +
                getSharedPreferences("settings", MODE_PRIVATE).getString("proot_mode", "auto") +
                "\n\n=== 当前状态 ===\n" + tail(getFileStreamPath("runtime-status.txt"), 1024) +
                "\n\n=== runtime.log ===\n" + tail(getFileStreamPath("runtime.log"), 24000) +
                "\n\n=== MySQL 启动日志 ===\n" + tail(new File(getFilesDir(), "ubuntu/tmp/mysql-lab.log"), 8000) +
                "\n\n=== MySQL 初始化日志 ===\n" + tail(new File(getFilesDir(), "ubuntu/tmp/mysql-bootstrap.log"), 8000);
        TextView content = new TextView(this);
        content.setText(log);
        content.setTextSize(12);
        content.setTextIsSelectable(true);
        content.setPadding(dp(18), dp(12), dp(18), dp(12));
        ScrollView scroll = new ScrollView(this);
        scroll.addView(content);
        String copyText = log;
        new AlertDialog.Builder(this).setTitle("诊断日志")
                .setView(scroll)
                .setPositiveButton("复制诊断", (dialog, which) -> {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    clipboard.setPrimaryClip(ClipData.newPlainText("MySQL Lab 诊断", copyText));
                    Toast.makeText(this, "诊断信息已复制", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("关闭", null)
                .show();
    }

    private void poll() {
        if (isFinishing()) return;
        new Thread(() -> {
            boolean ready = false;
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL("http://127.0.0.1:3000/api/health").openConnection();
                conn.setConnectTimeout(800);
                conn.setReadTimeout(800);
                ready = conn.getResponseCode() == 200;
                conn.disconnect();
            } catch (Exception ignored) { }
            String message = "正在启动本地服务…";
            try {
                message = new String(Files.readAllBytes(getFileStreamPath("runtime-status.txt").toPath()), StandardCharsets.UTF_8);
            } catch (Exception ignored) { }
            boolean finalReady = ready;
            String finalMessage = message;
            runOnUiThread(() -> {
                if (finalReady && !pageOpened) {
                    pageOpened = true;
                    loadingContainer.setVisibility(View.GONE);
                    webView.setVisibility(View.VISIBLE);
                    webView.loadUrl("http://127.0.0.1:3000/");
                } else if (!finalReady) {
                    status.setText(finalMessage);
                    boolean failed = finalMessage.startsWith("启动失败：");
                    spinner.setVisibility(failed ? View.GONE : View.VISIBLE);
                    loadingAdvice.setText(startupAdvice(finalMessage));
                }
                handler.postDelayed(this::poll, 1500);
            });
        }, "health-check").start();
    }

    @Override public void onBackPressed() {
        if (pageOpened && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
