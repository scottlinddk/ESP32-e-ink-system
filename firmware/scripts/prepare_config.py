"""Generate release configuration without fragile, value-specific sed replacements."""

import argparse
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit


def render_config(template: str, version: str, api_url: str = "") -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}", version):
        raise ValueError("Version must contain only letters, numbers, dots, +, _, or -")
    replacements = {"FIRMWARE_VERSION": version}
    if api_url.strip():
        api_url = api_url.strip().rstrip("/")
        parsed = urlsplit(api_url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ("", "/api")
                or len(api_url) >= 192 or any(ord(c) <= 32 or c in '\\"\'<>' for c in api_url)):
            raise ValueError("API URL must be an HTTPS origin, optionally /api, shorter than 192 characters")
        replacements["PROVISION_DEFAULT_API_URL"] = api_url
    for key, value in replacements.items():
        template, count = re.subn(
            rf'^#define\s+{key}\s+"[^"\n]*"\s*$',
            lambda _match: f"#define {key} {json.dumps(value)}",
            template,
            flags=re.MULTILINE,
        )
        if count != 1:
            raise ValueError(f"Expected exactly one {key} definition, found {count}")
    return template


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-dir", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--version", required=True)
    parser.add_argument("--api-url", default=os.environ.get("PRODUCTION_API_URL", ""))
    args = parser.parse_args()
    output = render_config((args.project_dir / "config.h.example").read_text(encoding="utf-8"), args.version, args.api_url)
    (args.project_dir / "config.h").write_text(output, encoding="utf-8")
    print(f"Prepared {args.project_dir / 'config.h'} for version {args.version}")


if __name__ == "__main__":
    main()
