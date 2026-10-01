package dev.ergolab.mysqllab;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardOpenOption;

public final class RuntimeService extends Service {
    private Thread worker;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel("runtime", "本地 MySQL 服务", NotificationManager.IMPORTANCE_LOW));
        }
        Notification notification = new Notification.Builder(this, "runtime")
                .setContentTitle("MySQL Lab")
                .setContentText("本地数据库正在运行")
                .setSmallIcon(R.drawable.ic_status)
                .build();
        startForeground(1, notification);
        if (worker == null || !worker.isAlive()) {
            worker = new Thread(() -> {
                try { new RuntimeInstaller(this).start(); }
                catch (Exception error) {
                    try {
                        java.io.StringWriter trace = new java.io.StringWriter();
                        error.printStackTrace(new java.io.PrintWriter(trace));
                        Files.write(getFileStreamPath("runtime.log").toPath(),
                                ("Startup failure:\n" + trace + "\n").getBytes(StandardCharsets.UTF_8),
                                StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                    } catch (Exception ignored) { }
                    try { Files.write(getFileStreamPath("runtime-status.txt").toPath(),
                            ("启动失败：" + error.getMessage()).getBytes(StandardCharsets.UTF_8)); }
                    catch (Exception ignored) { }
                }
            }, "mysql-lab-runtime");
            worker.start();
        }
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
