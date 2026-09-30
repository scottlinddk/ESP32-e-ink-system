Import("env")
from pathlib import Path
import re

project = Path(env.subst("$PROJECT_DIR"))
config_path = project / "config.h"
if not config_path.is_file():
    config_path = project / "config.h.example"
content = config_path.read_text(encoding="utf-8")
match = re.search(r'#define\s+FIRMWARE_VERSION\s+"([^"]+)"', content)
if not match:
    raise RuntimeError(f"FIRMWARE_VERSION not found in {config_path}")
print(f"version_check: FIRMWARE_VERSION = {match.group(1)} ({config_path.name})")
