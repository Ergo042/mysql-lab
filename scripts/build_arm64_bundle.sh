#!/usr/bin/env bash
set -euo pipefail

# Run on a native Ubuntu 24.04 arm64 host. The APK then extracts this verified
# user space instead of running apt/dpkg/npm on every phone.
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ubuntu_mirror="${UBUNTU_ARM64_MIRROR:-http://mirrors.aliyun.com/ubuntu-ports/}"
if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "This bundle must be built on native ARM64 Linux." >&2
  exit 1
fi
for tool in sudo debootstrap curl npm tar gzip sha256sum mountpoint; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done

mkdir -p "$repo/build" "$repo/prebuilt"
work="$(mktemp -d "$repo/build/offline-arm64.XXXXXX")"
rootfs="$work/rootfs"
cleanup() {
  for mount_dir in sys proc dev; do
    if mountpoint -q "$rootfs/$mount_dir"; then sudo umount "$rootfs/$mount_dir"; fi
  done
  if [[ "$work" == "$repo/build/offline-arm64."* ]]; then sudo rm -rf -- "$work"; fi
}
trap cleanup EXIT

sudo debootstrap --variant=minbase --arch=arm64 noble "$rootfs" "$ubuntu_mirror"
sudo mkdir -p "$rootfs/etc/apt/sources.list.d" "$rootfs/opt"
echo '# Managed by MySQL Lab' | sudo tee "$rootfs/etc/apt/sources.list" >/dev/null
sudo tee "$rootfs/etc/apt/sources.list.d/ubuntu.sources" >/dev/null <<SOURCES
Types: deb
URIs: $ubuntu_mirror
Suites: noble noble-updates noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
SOURCES
sudo tee "$rootfs/usr/sbin/policy-rc.d" >/dev/null <<'POLICY'
#!/bin/sh
exit 101
POLICY
sudo chmod 755 "$rootfs/usr/sbin/policy-rc.d"
sudo cp -L /etc/resolv.conf "$rootfs/etc/resolv.conf"
sudo mount --bind /dev "$rootfs/dev"
sudo mount -t proc proc "$rootfs/proc"
sudo mount --bind /sys "$rootfs/sys"
sudo chroot "$rootfs" /usr/bin/env DEBIAN_FRONTEND=noninteractive apt-get update -o APT::Update::Error-Mode=any
sudo chroot "$rootfs" /usr/bin/env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends mysql-server ca-certificates
sudo chroot "$rootfs" test -d /var/lib/mysql/mysql
sudo chroot "$rootfs" apt-get clean
sudo rm -f "$rootfs/usr/sbin/policy-rc.d"
sudo rm -f "$rootfs/var/lib/mysql/auto.cnf"
sudo rm -f "$rootfs/var/lib/mysql/ca.pem" "$rootfs/var/lib/mysql/server-cert.pem" "$rootfs/var/lib/mysql/server-key.pem"
sudo rm -f "$rootfs/var/lib/mysql/client-cert.pem" "$rootfs/var/lib/mysql/client-key.pem"
sudo rm -f "$rootfs/var/lib/mysql/private_key.pem" "$rootfs/var/lib/mysql/public_key.pem"
sudo rm -rf "$rootfs/var/lib/apt/lists"/*
for mount_dir in sys proc dev; do sudo umount "$rootfs/$mount_dir"; done

node_name="node-v22.16.0-linux-arm64"
node_archive="$work/$node_name.tar.gz"
if ! curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 --output "$node_archive" \
    "https://mirrors.nju.edu.cn/nodejs-release/v22.16.0/$node_name.tar.gz"; then
  curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 --output "$node_archive" \
    "https://nodejs.org/dist/v22.16.0/$node_name.tar.gz"
fi
echo "1725602e9fb150eb8b8220a899085190e1c04d1a5f3862b01c3dc1dfce0157f9  $node_archive" | sha256sum --check --status
sudo tar -xzf "$node_archive" -C "$rootfs/opt"
sudo mkdir -p "$rootfs/opt/mysql-lab"
sudo cp "$repo/server.js" "$repo/package.json" "$repo/package-lock.json" "$rootfs/opt/mysql-lab/"
sudo cp -a "$repo/public" "$rootfs/opt/mysql-lab/"
sudo chown -R "$(id -u):$(id -g)" "$rootfs/opt/mysql-lab"
sed -i 's#https://registry.npmjs.org/#https://registry.npmmirror.com/#g' \
  "$rootfs/opt/mysql-lab/package-lock.json"
export npm_config_registry="https://registry.npmmirror.com/"
npm ci --prefix "$rootfs/opt/mysql-lab" --omit=dev --no-audit --no-fund
test -d "$rootfs/opt/mysql-lab/node_modules/mysql2"

bundle="$repo/prebuilt/arm64-rootfs.tar.gz"
sudo tar --numeric-owner --exclude='./dev/*' --exclude='./proc/*' --exclude='./sys/*' \
  --exclude='./run/*' --exclude='./tmp/*' -C "$rootfs" -cf - . | gzip -9 > "$bundle"
sha256sum "$bundle" | cut -d ' ' -f 1 > "$repo/prebuilt/arm64-rootfs.sha256"
echo "Created $bundle ($(du -h "$bundle" | cut -f 1))"
