"""Bundle PRoot and its Android shared-library dependencies from Termux.

The Termux package index supplies exact package paths and SHA-256 hashes. This
script verifies every .deb before putting its ELF files into Android jniLibs.
"""

from __future__ import annotations

import hashlib
import gzip
import io
import pathlib
import subprocess
import tarfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / "build" / "termux-packages"
OUT = ROOT / "app" / "src" / "main" / "jniLibs"
BASE = "https://packages.termux.dev/apt/termux-main/"
PACKAGES = ("proot", "libtalloc", "libandroid-shmem", "libc++")
ARCHES = {"aarch64": "arm64-v8a", "x86_64": "x86_64"}
PINNED = {"proot": "5.1.107.95", "libtalloc": "2.4.3", "libandroid-shmem": "0.7", "libc++": "30"}


def fetch(url: str, target: pathlib.Path) -> bytes:
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl.exe", "-fL", "--retry", "3", "--connect-timeout", "15", "--max-time", "120",
                        "-o", str(target), url], check=True)
    return target.read_bytes()


def package_index(arch: str) -> dict[str, dict[str, str]]:
    url = BASE + f"dists/stable/main/binary-{arch}/Packages.gz"
    raw = fetch(url, CACHE / f"Packages-{arch}.gz")
    blocks = gzip.decompress(raw).decode().split("\n\n")
    packages: dict[str, dict[str, str]] = {}
    for block in blocks:
        fields: dict[str, str] = {}
        for line in block.splitlines():
            if line and not line.startswith(" ") and ": " in line:
                key, value = line.split(": ", 1)
                fields[key] = value
        if fields.get("Package") in PACKAGES:
            packages[fields["Package"]] = fields
    return packages


def data_archive(deb: bytes) -> bytes:
    if not deb.startswith(b"!<arch>\n"):
        raise ValueError("Invalid .deb archive")
    offset = 8
    while offset < len(deb):
        header = deb[offset : offset + 60]
        name = header[:16].decode().strip().rstrip("/")
        size = int(header[48:58].decode().strip())
        payload = deb[offset + 60 : offset + 60 + size]
        if name.startswith("data.tar"):
            return payload
        offset += 60 + size + (size & 1)
    raise ValueError("No data archive in .deb")


def package_files(info: dict[str, str]) -> dict[str, bytes]:
    filename = info["Filename"]
    data = fetch(BASE + filename, CACHE / pathlib.Path(filename).name)
    digest = hashlib.sha256(data).hexdigest()
    if digest != info["SHA256"]:
        raise ValueError(f"SHA256 mismatch for {filename}")
    with tarfile.open(fileobj=io.BytesIO(data_archive(data)), mode="r:*") as archive:
        return {
            pathlib.PurePosixPath(member.name).name: archive.extractfile(member).read()
            for member in archive.getmembers()
            if member.isfile() and ("/bin/proot" in member.name or "/lib/" in member.name
                                    or "/libexec/proot/loader" in member.name)
        }


def main() -> None:
    for arch, android_abi in ARCHES.items():
        index = package_index(arch)
        missing = set(PACKAGES) - index.keys()
        if missing:
            raise RuntimeError(f"Missing {missing} for {arch}")
        for package, version in PINNED.items():
            if index[package]["Version"] != version:
                raise RuntimeError(f"{package} version changed; review before updating {version} -> {index[package]['Version']}")
        files: dict[str, bytes] = {}
        for package in PACKAGES:
            print(f"{arch}: {package} {index[package]['Version']}")
            files.update(package_files(index[package]))
        output = OUT / android_abi
        output.mkdir(parents=True, exist_ok=True)
        proot = files["proot"]
        # Android extracts only lib*.so entries from jniLibs. Rename PRoot's
        # versioned talloc DT_NEEDED in-place, preserving ELF string offsets.
        old = b"libtalloc.so.2\x00"
        if old in proot:
            proot = proot.replace(old, b"libtalloc.so\x00\x00\x00")
        (output / "libproot.so").write_bytes(proot)
        (output / "libproot-loader.so").write_bytes(files["loader"])
        for name in ("libtalloc.so", "libandroid-shmem.so", "libc++_shared.so"):
            matches = [(key, value) for key, value in files.items() if key == name or key.startswith(name + ".")]
            if not matches:
                raise RuntimeError(f"{name} missing for {arch}")
            (output / name).write_bytes(matches[-1][1])
        (output / "versions.txt").write_text("\n".join(f"{p}={index[p]['Version']}" for p in PACKAGES) + "\n")
        print(f"Wrote {output}")


if __name__ == "__main__":
    main()
