package dev.ergolab.mysqllab;

import android.system.Os;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/** Extracts a verified Ubuntu Base tarball without resolving guest symlinks on Android. */
final class TarExtractor {
    private static final int BLOCK = 512;

    static void extract(File archive, File root) throws Exception {
        String longName = null;
        String longLink = null;
        Map<String, String> pax = new HashMap<>();
        try (InputStream input = new GZIPInputStream(new FileInputStream(archive), 65536)) {
            byte[] header = new byte[BLOCK];
            while (readFully(input, header, BLOCK) == BLOCK) {
                if (header[0] == 0) break;
                String name = string(header, 0, 100);
                String prefix = string(header, 345, 155);
                if (!prefix.isEmpty()) name = prefix + "/" + name;
                String link = string(header, 157, 100);
                long size = octal(header, 124, 12);
                int mode = (int) octal(header, 100, 8);
                char type = (char) header[156];
                if (type == 'L' || type == 'K' || type == 'x' || type == 'g') {
                    if (size > 1024 * 1024) throw new IllegalStateException("tar 扩展头过大");
                    byte[] extension = new byte[(int) size];
                    if (readFully(input, extension, extension.length) != extension.length) throw new IllegalStateException("tar 数据不完整");
                    skipPadding(input, size);
                    if (type == 'L') longName = cString(extension);
                    else if (type == 'K') longLink = cString(extension);
                    else if (type == 'x') pax = parsePax(extension);
                    continue;
                }
                if (longName != null) name = longName;
                if (longLink != null) link = longLink;
                name = pax.getOrDefault("path", name);
                link = pax.getOrDefault("linkpath", link);
                longName = null;
                longLink = null;
                pax.clear();
                if (name.startsWith("/") || name.contains("../")) throw new IllegalStateException("tar 包含不安全路径：" + name);
                Path rootPath = root.toPath().toAbsolutePath().normalize();
                Path targetPath = rootPath.resolve(name).normalize();
                if (!targetPath.startsWith(rootPath)) throw new IllegalStateException("tar 路径越界：" + name);
                File target = targetPath.toFile();
                File parent = target.getParentFile();
                if (!parent.isDirectory() && !parent.mkdirs()) throw new IllegalStateException("无法创建目录：" + parent);
                if (type == '5') {
                    if (!target.isDirectory() && !target.mkdirs()) throw new IllegalStateException("无法创建目录：" + target);
                    target.setExecutable(true, false);
                } else if (type == '2') {
                    Files.deleteIfExists(target.toPath());
                    Os.symlink(link, target.getAbsolutePath());
                } else if (type == '1') {
                    Files.deleteIfExists(target.toPath());
                    Path sourcePath = rootPath.resolve(link).normalize();
                    if (!sourcePath.startsWith(rootPath)) throw new IllegalStateException("tar 硬链接越界：" + link);
                    File source = sourcePath.toFile();
                    // Android's app sandbox may deny hard links. A relative
                    // symlink preserves the guest-visible path in PRoot.
                    String relative = target.getParentFile().toPath().relativize(source.toPath()).toString();
                    Os.symlink(relative, target.getAbsolutePath());
                } else if (type == '0' || type == 0 || type == '7') {
                    Files.deleteIfExists(target.toPath());
                    try (FileOutputStream output = new FileOutputStream(target)) {
                        byte[] buffer = new byte[65536];
                        long remaining = size;
                        while (remaining > 0) {
                            int n = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                            if (n < 0) throw new IllegalStateException("tar 文件不完整：" + name);
                            output.write(buffer, 0, n);
                            remaining -= n;
                        }
                    }
                    target.setExecutable((mode & 0111) != 0, false);
                    skipPadding(input, size);
                    continue;
                }
                skip(input, size);
                skipPadding(input, size);
            }
        }
    }

    private static Map<String, String> parsePax(byte[] bytes) {
        Map<String, String> values = new HashMap<>();
        int offset = 0;
        while (offset < bytes.length) {
            int space = offset;
            while (space < bytes.length && bytes[space] != ' ') space++;
            if (space == bytes.length) break;
            int length = Integer.parseInt(new String(bytes, offset, space - offset, StandardCharsets.US_ASCII));
            String entry = new String(bytes, space + 1, length - (space + 1 - offset) - 1, StandardCharsets.UTF_8);
            int equals = entry.indexOf('=');
            if (equals > 0) values.put(entry.substring(0, equals), entry.substring(equals + 1));
            offset += length;
        }
        return values;
    }

    private static String cString(byte[] value) {
        int end = 0;
        while (end < value.length && value[end] != 0) end++;
        return new String(value, 0, end, StandardCharsets.UTF_8).trim();
    }

    private static String string(byte[] bytes, int offset, int length) {
        int end = offset;
        while (end < offset + length && bytes[end] != 0) end++;
        return new String(bytes, offset, end - offset, StandardCharsets.UTF_8);
    }

    private static long octal(byte[] bytes, int offset, int length) {
        String value = string(bytes, offset, length).trim();
        return value.isEmpty() ? 0 : Long.parseLong(value, 8);
    }

    private static int readFully(InputStream input, byte[] bytes, int length) throws Exception {
        int offset = 0;
        while (offset < length) {
            int n = input.read(bytes, offset, length - offset);
            if (n < 0) return offset;
            offset += n;
        }
        return offset;
    }

    private static void skip(InputStream input, long count) throws Exception {
        byte[] buffer = new byte[65536];
        while (count > 0) {
            int n = input.read(buffer, 0, (int) Math.min(buffer.length, count));
            if (n < 0) throw new IllegalStateException("tar 数据不完整");
            count -= n;
        }
    }

    private static void skipPadding(InputStream input, long size) throws Exception {
        skip(input, (BLOCK - size % BLOCK) % BLOCK);
    }
}
