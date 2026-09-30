import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from package_web_firmware import BOARDS, check_image, check_partitions, package_board, write_manifests
from prepare_config import render_config


def image(chip_id):
    data = bytearray(64)
    data[0] = 0xE9
    struct.pack_into("<H", data, 12, chip_id)
    return bytes(data)


def partition_table(app_size=0x300000, address=0x10000):
    return struct.pack("<HBBII16sI", 0x50AA, 0, 0x10, address, app_size, b"app0", 0) + bytes([0xFF]) * 32


class ConfigurationTests(unittest.TestCase):
    template = '#define PROVISION_DEFAULT_API_URL "https://example.com/api"\n#define FIRMWARE_VERSION "9.9.9"\n'

    def test_version_injection_does_not_depend_on_old_version(self):
        result = render_config(self.template, "dev-20260930-a123bcd")
        self.assertIn('FIRMWARE_VERSION "dev-20260930-a123bcd"', result)
        self.assertIn('PROVISION_DEFAULT_API_URL "https://example.com/api"', result)

    def test_empty_secret_retains_default_and_url_override_trims_slash(self):
        self.assertIn('"https://example.com/api"', render_config(self.template, "1.2.3", "  "))
        self.assertIn('"https://backend.example/api"', render_config(self.template, "1.2.3", "https://backend.example/api/"))

    def test_missing_define_or_unsafe_input_fails(self):
        for version in ('1.2.3\n#define EVIL 1', '"broken"', 'a' * 65):
            with self.assertRaises(ValueError):
                render_config(self.template, version)
        with self.assertRaises(ValueError):
            render_config("", "1.2.3")
        for url in ("https://user:password@example.com", "http://example.com", "https://example.com/wrong/api", "https://example.com/?x=1"):
            with self.assertRaises(ValueError):
                render_config(self.template, "1.2.3", url)


class PackagingTests(unittest.TestCase):
    def test_wrong_chip_image_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "firmware.bin"
            path.write_bytes(image(0))
            with self.assertRaisesRegex(ValueError, "ESP32-S3"):
                check_image(path, BOARDS[1])

    def test_partition_offset_size_and_flash_limits_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "partitions.bin"
            for table, app_size in ((partition_table(address=0x20000), 100), (partition_table(app_size=0x1000), 0x1001), (partition_table(app_size=0x800000), 100)):
                path.write_bytes(table)
                with self.assertRaises(ValueError):
                    check_partitions(path, app_size, 0x800000)

    def test_all_boards_include_boot_app_and_correct_patched_offsets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "release"
            output.mkdir()
            core = root / "core"
            boot_app = core / "packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
            boot_app.parent.mkdir(parents=True)
            boot_app.write_bytes(b"B" * 0x2000)
            esptool = core / "packages/tool-esptoolpy/esptool.py"
            esptool.parent.mkdir(parents=True)
            esptool.touch()
            builds = []
            for board in BOARDS:
                build = root / ".pio/build" / board.environment
                build.mkdir(parents=True)
                (build / "bootloader.bin").write_bytes(image(board.chip_id))
                (build / "firmware.bin").write_bytes(image(board.chip_id))
                (build / "partitions.bin").write_bytes(partition_table())

                def merge(command, check):
                    self.assertTrue(check)
                    self.assertEqual(command[command.index("--chip") + 1], board.chip)
                    self.assertEqual(command[command.index("--flash_size") + 1], board.flash_size)
                    self.assertEqual(command[command.index("--flash_freq") + 1], board.flash_freq)
                    self.assertEqual(command[command.index("--flash_mode") + 1], "dio")
                    self.assertEqual(command[-8], hex(board.boot_offset))
                    self.assertEqual(command[-4], "0xe000")
                    data = bytearray([0xFF]) * (0x10000 + 64)
                    for offset, source in zip(command[-8::2], command[-7::2]):
                        part = Path(source).read_bytes()
                        data[int(offset, 16):int(offset, 16) + len(part)] = part
                    data[board.boot_offset + 2:board.boot_offset + 4] = bytes((2, board.size_freq_byte))
                    Path(command[command.index("--output") + 1]).write_bytes(data)

                with patch("package_web_firmware.subprocess.run", side_effect=merge):
                    builds.append(package_board(board, root, output, core))
            write_manifests(output, "2.0.0", builds)
            default = json.loads((output / "manifest.json").read_text())
            v12 = json.loads((output / "manifest-elecrow-v12.json").read_text())
            self.assertEqual([entry["chipFamily"] for entry in default["builds"]], ["ESP32", "ESP32-S3"])
            self.assertEqual(v12["builds"], [{"chipFamily": "ESP32-S3", "parts": [{"path": "firmware-elecrow-v12-factory.bin", "offset": 0}]}])
            self.assertEqual(default["version"], "2.0.0")
            self.assertTrue(default["new_install_prompt_erase"])
            self.assertIn("firmware-elecrow-factory.bin", (output / "SHA256SUMS").read_text())


if __name__ == "__main__":
    unittest.main()
