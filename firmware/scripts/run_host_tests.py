#!/usr/bin/env python3
"""Compile and run protocol/display/Wi-Fi tests without a board. Requires C++17 or Zig."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", default=os.environ.get("CXX", "c++"))
    parser.add_argument("--zig", help="Path to a Zig executable (uses zig c++)")
    args = parser.parse_args()
    firmware = Path(__file__).resolve().parents[1]
    compiler = [args.zig, "c++"] if args.zig else [args.compiler]
    if not shutil.which(compiler[0]):
        parser.error("C++ compiler not found; set CXX or pass --compiler / --zig")
    common = ["-std=c++17", "-O0", "-g", "-Wall", "-Wextra", "-Werror",
              "-I" + str(firmware / "src"), "-I" + str(firmware / "tests/stubs"),
              "-I" + str(firmware / "lib/EPD")]
    driver = [firmware / "lib/EPD/EPD.cpp", firmware / "lib/EPD/GUI_Paint.cpp"]
    cases = [
        ("bitmap", "bitmap_test.cpp", [], []),
        ("ble-frame", "ble_frame_test.cpp", [], []),
        ("feed-validation", "feed_validation_test.cpp", [], []),
        ("wifi-manager", "wifi_manager_test.cpp", [firmware / "src/wifi_manager.cpp"],
         ["-I" + str(firmware / "tests/wifi_stubs")]),
        ("ssd1680", "epd_test.cpp", driver, []),
        ("jd79661", "epd_test.cpp", driver, ["-DELECROW_PANEL_JD79661"]),
    ]
    with tempfile.TemporaryDirectory(prefix="eink-host-tests-") as tmp:
        for name, test, sources, flags in cases:
            output = Path(tmp) / (name + (".exe" if os.name == "nt" else ""))
            subprocess.run(compiler + flags + common + [str(firmware / "tests" / test)]
                           + list(map(str, sources)) + ["-o", str(output)], check=True)
            subprocess.run([str(output)], check=True)
            print(f"PASS: {name}", flush=True)


if __name__ == "__main__":
    main()
