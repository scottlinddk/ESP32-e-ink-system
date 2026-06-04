Import("env")
import re
import os


def get_version_from_config():
    config_path = os.path.join(env.subst("$PROJECT_DIR"), "config.h")
    if not os.path.exists(config_path):
        print("version_check: WARNING: config.h not found, skipping version validation")
        return None

    with open(config_path, "r") as f:
        content = f.read()

    match = re.search(r'#define\s+FIRMWARE_VERSION\s+"([^"]+)"', content)
    if not match:
        print("version_check: WARNING: FIRMWARE_VERSION not found in config.h")
        return None

    return match.group(1)


version = get_version_from_config()

if version is not None:
    print(f"version_check: FIRMWARE_VERSION = {version}")
    if not re.match(r'^\d+\.\d+\.\d+', version):
        print(f"version_check: WARNING: '{version}' does not follow semver (X.Y.Z)")
    else:
        print("version_check: version format OK")
