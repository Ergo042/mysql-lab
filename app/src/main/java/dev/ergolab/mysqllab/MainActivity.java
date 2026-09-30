package dev.ergolab.mysqllab;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
    private boolean pageOpened;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xfff7f9fd);
        getWindow().setNavigationBarColor(0xfff7f9fd);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xfff5f7fb);
        loading = new LinearLayout(this);
        loading.setOrientation(LinearLayout.VERTICAL);
        int inset = dp(24);
        loading.setPadding(inset, dp(56), inset, inset);
        loading.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView title = new TextView(this);
        title.setText("MySQL Lab");
        title.setTextSize(30);
        title.setTextColor(0xff182438);
        loading.addView(title);
        spinner = new ProgressBar(this);
        LinearLayout.LayoutParams spinParams = new LinearLayout.LayoutParams(dp(52), dp(52));
        spinParams.topMargin = dp(30);
        loading.addView(spinner, spinParams);
        status = new TextView(this);
        status.setTextSize(16);
        status.setTextColor(0xff35445c);
        status.setGravity(Gravity.CENTER);
        status.setText("正在准备本地服务…");
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(24);
        loading.addView(status, statusParams);
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
        detail.setTextColor(0xff70829a);
        detail.setTextSize(14);
        detail.setGravity(Gravity.CENTER);
        detail.setLineSpacing(dp(5), 1f);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(-1, -2);
        detailParams.topMargin = dp(18);
        loading.addView(detail, detailParams);
        Button retry = new Button(this);
        retry.setText("重试启动");
        retry.setOnClickListener(v -> {
            spinner.setVisibility(View.VISIBLE);
            status.setText("正在重试启动…");
            startService(new Intent(this, RuntimeService.class));
        });
        loading.addView(retry);
        Button settings = new Button(this);
        settings.setText("设置下载镜像与显示大小");
        settings.setOnClickListener(v -> showSettings());
        loading.addView(settings);
        Button logs = new Button(this);
        logs.setText("查看安装日志");
        logs.setOnClickListener(v -> showInstallLog());
        loading.addView(logs);
        root.addView(loading, new LinearLayout.LayoutParams(-1, -1));
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

    public static final class AppBridge {
        private final MainActivity activity;
        public AppBridge(MainActivity activity) { this.activity = activity; }
        @JavascriptInterface public void openSettings() {
            activity.runOnUiThread(activity::showSettings);
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

    private void showInstallLog() {
        String log;
        File file = getFileStreamPath("runtime.log");
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            long start = Math.max(0, input.length() - 16000);
            input.seek(start);
            byte[] bytes = new byte[(int) (input.length() - start)];
            input.readFully(bytes);
            log = new String(bytes, StandardCharsets.UTF_8);
            if (start > 0) log = "…仅显示最后 16 KB…\n" + log;
        } catch (Exception error) {
            log = "尚无安装日志：" + error.getMessage();
        }
        TextView content = new TextView(this);
        content.setText(log);
        content.setTextSize(12);
        content.setTextIsSelectable(true);
        content.setPadding(dp(18), dp(12), dp(18), dp(12));
        ScrollView scroll = new ScrollView(this);
        scroll.addView(content);
        String copyText = log;
        new AlertDialog.Builder(this).setTitle("安装日志")
                .setView(scroll)
                .setPositiveButton("复制日志", (dialog, which) -> {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    clipboard.setPrimaryClip(ClipData.newPlainText("MySQL Lab 安装日志", copyText));
                    Toast.makeText(this, "日志已复制", Toast.LENGTH_SHORT).show();
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
                    loading.setVisibility(View.GONE);
                    webView.setVisibility(View.VISIBLE);
                    webView.loadUrl("http://127.0.0.1:3000/");
                } else if (!finalReady) {
                    status.setText(finalMessage);
                    spinner.setVisibility(finalMessage.startsWith("启动失败：") ? View.INVISIBLE : View.VISIBLE);
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
