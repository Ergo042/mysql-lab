# Android APK 第三方组件

Android 构建包含 Termux 仓库提供的 ARM64、x86_64 二进制文件。`scripts/prepare_proot.py` 从 Termux 软件包索引取得文件、校验每个 `.deb` 的 SHA-256，并将这些文件放入 `app/src/main/jniLibs/`。可在该脚本与 `jniLibs/*/versions.txt` 查看精确版本。

| 组件 | 版本 | 源码与许可 |
| --- | --- | --- |
| PRoot 与 loader | 5.1.107.95 | [Termux PRoot](https://github.com/termux/proot)，GPL-2.0 |
| libtalloc | 2.4.3 | [Samba talloc](https://talloc.samba.org/)，LGPL-3.0-or-later |
| libandroid-shmem | 0.7 | [Termux libandroid-shmem](https://github.com/termux/libandroid-shmem)，BSD-3-Clause |
| libc++ | 30 | [Android NDK libc++](https://android.googlesource.com/platform/ndk/)，Apache-2.0 with LLVM exception |

构建脚本将 PRoot ELF 的 `DT_NEEDED` 字符串 `libtalloc.so.2` 原位替换为 `libtalloc.so`，供 Android 从 APK 提取共享库。其他 PRoot 源码未修改。Ubuntu Base、Node.js 和 MySQL 软件包在应用首次运行时从其发行源取得，各自适用相应许可。
