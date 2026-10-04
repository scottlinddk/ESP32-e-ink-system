"""Package complete, header-patched ESP Web Tools images from PlatformIO builds."""

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys


@dataclass(frozen=True)
class Board:
    environment: str
    suffix: str
    chip: str
    family: str
    chip_id: int
    boot_offset: int
    flash_size: str
    flash_freq: str
    size_freq_byte: int
    # Names the hardware in release filenames. Keep in sync with ASSET_BOARD_SLUGS in
    # backend/src/services/githubRelease.ts, which also accepts the legacy names.
    slug: str


BOARDS = (
    Board("esp32dev", "", "esp32", "ESP32", 0, 0x1000, "4MB", "40m", 0x20, "waveshare-esp32-213-v2"),
    Board("elecrow_213", "-elecrow", "esp32s3", "ESP32-S3", 9, 0, "8MB", "80m", 0x3F, "elecrow-crowpanel-213"),
    Board("elecrow_213_v12", "-elecrow-v12", "esp32s3", "ESP32-S3", 9, 0, "8MB", "80m", 0x3F, "elecrow-crowpanel-213-v12"),
)


def asset_name(board: Board, version: str, image: str) -> str:
    """Descriptive release filename: board, firmware version and image (factory, app, bootloader, partitions)."""
    safe_version = re.sub(r"[^a-zA-Z0-9._-]", "_", version)
    return f"{board.slug}_fw-{safe_version}_{image}.bin"


def check_image(path: Path, board: Board):
    data = path.read_bytes()
    if len(data) < 24 or data[0] != 0xE9:
        raise ValueError(f"{path}: missing ESP image header")
    if struct.unpack_from("<H", data, 12)[0] != board.chip_id:
        raise ValueError(f"{path}: image is not built for {board.family}")
    return data


def check_partitions(path: Path, app_size: int, flash_size: int):
    """Reject wrong app offsets, an oversized app, or partitions beyond flash."""
    data = path.read_bytes()
    app_partition = None
    for offset in range(0, len(data) - 31, 32):
        magic, kind, subtype, address, size = struct.unpack_from("<HBBII", data, offset)
        if magic != 0x50AA:
            break
        if address + size > flash_size:
            raise ValueError(f"{path}: partition exceeds configured flash size")
        if kind == 0 and subtype in (0, 0x10):
            app_partition = (address, size)
    if app_partition is None or app_partition[0] != 0x10000:
        raise ValueError(f"{path}: expected factory/ota_0 application at 0x10000")
    if app_size > app_partition[1]:
        raise ValueError(f"{path}: application does not fit its partition")


def package_board(board: Board, project: Path, output: Path, core: Path, version: str):
    build = project / ".pio" / "build" / board.environment
    bootloader = build / "bootloader.bin"
    partitions = build / "partitions.bin"
    app = build / "firmware.bin"
    boot_app = core / "packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
    esptool = core / "packages/tool-esptoolpy/esptool.py"
    boot_data = check_image(bootloader, board)
    app_data = check_image(app, board)
    flash_size = int(board.flash_size[:-2]) * 1024 * 1024
    check_partitions(partitions, len(app_data), flash_size)
    if len(boot_data) > 0x8000 - board.boot_offset or partitions.stat().st_size > 0x6000:
        raise ValueError(f"{board.environment}: bootloader or partitions overlap the next image")
    if not boot_app.is_file() or not esptool.is_file():
        raise FileNotFoundError("PlatformIO esptool/boot_app0 missing; build the firmware first or set --platformio-core")
    if boot_app.stat().st_size != 0x2000:
        raise ValueError("Unexpected boot_app0 size (expected 8192 bytes)")
    factory = output / asset_name(board, version, "factory")
    # Arduino/IDF's qio bootloader must be patched to dio for browser flashing,
    # just as the CLI uploader does. S3 uses offset 0, unlike classic ESP32.
    subprocess.run([
        sys.executable, str(esptool), "--chip", board.chip, "merge_bin",
        "--output", str(factory), "--flash_mode", "dio", "--flash_freq", board.flash_freq,
        "--flash_size", board.flash_size,
        hex(board.boot_offset), str(bootloader), "0x8000", str(partitions),
        "0xe000", str(boot_app), "0x10000", str(app),
    ], check=True)
    merged = factory.read_bytes()
    if len(merged) != 0x10000 + len(app_data):
        raise ValueError(f"{factory}: merged image length is incorrect")
    if merged[board.boot_offset + 2:board.boot_offset + 4] != bytes((2, board.size_freq_byte)):
        raise ValueError(f"{factory}: bootloader flash header was not patched")
    if merged[0x10000:] != app_data or merged[0xe000:0x10000] != boot_app.read_bytes() or merged[0x8000:0x8000 + partitions.stat().st_size] != partitions.read_bytes():
        raise ValueError(f"{factory}: merged image is missing or has altered firmware parts")
    for source, image in ((app, "app"), (bootloader, "bootloader"), (partitions, "partitions")):
        shutil.copyfile(source, output / asset_name(board, version, image))
    return {"chipFamily": board.family, "parts": [{"path": factory.name, "offset": 0}]}


def release_date() -> str:
    # SOURCE_DATE_EPOCH keeps reproducible builds reproducible; otherwise use the build time.
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    moment = datetime.fromtimestamp(int(epoch), timezone.utc) if epoch else datetime.now(timezone.utc)
    return moment.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_manifests(output: Path, version: str, builds: list[dict]):
    base = {"version": version, "release_date": release_date(),
            "new_install_prompt_erase": True, "new_install_improv_wait_time": 0}
    # S3 chip detection cannot distinguish the two physical display controllers.
    # Names match the backend's descriptive "<board> FW <version>" naming.
    for name, board, selected in (("manifest.json", "Elecrow CrowPanel 2.13", builds[:2]),
                                  ("manifest-elecrow-v12.json", "Elecrow CrowPanel 2.13 V1.2", builds[2:])):
        manifest = {"name": f"{board} FW {version}", **base, "builds": selected}
        (output / name).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    hashes = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}" for path in sorted(output.glob("*.bin"))]
    (output / "SHA256SUMS").write_text("\n".join(hashes) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-dir", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--platformio-core", type=Path, default=Path(os.environ.get("PLATFORMIO_CORE_DIR", Path.home() / ".platformio")))
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    builds = [package_board(board, args.project_dir, args.output_dir, args.platformio_core, args.version) for board in BOARDS]
    shutil.copyfile(args.platformio_core / "packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin", args.output_dir / "boot_app0.bin")
    write_manifests(args.output_dir, args.version, builds)
    print(f"Packaged all three boards in {args.output_dir}")


if __name__ == "__main__":
    main()
