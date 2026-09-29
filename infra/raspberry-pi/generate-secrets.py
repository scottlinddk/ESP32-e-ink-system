#!/usr/bin/env python3
"""Create local-only credentials without printing or replacing secrets.

Initial setup: python3 generate-secrets.py --output-dir /etc/esp32-eink
JWT renewal:   python3 generate-secrets.py --output-dir /secure/new-key \
                  --jwt-secret-env /etc/esp32-eink/.env

Renewal writes only backend.env, using the existing signing key. It does not
rotate database passwords or revoke earlier tokens. Replace the backend's
SUPABASE_SERVICE_ROLE_KEY before expiry; signing-key rotation needs coordinated
PostgREST/backend configuration changes (see the migration runbook).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
import time


def encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def service_jwt(secret: str, ttl_days: int, now: int | None = None) -> str:
    issued = int(time.time()) if now is None else now
    header = encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = encode(json.dumps({
        "role": "service_role", "iss": "esp32-eink", "aud": "esp32-eink-backend",
        "iat": issued, "exp": issued + ttl_days * 86400,
    }, separators=(",", ":")).encode())
    message = f"{header}.{payload}"
    signature = encode(hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest())
    return f"{message}.{signature}"


def read_signing_key(path: Path) -> str:
    # Parse only our simple generated key; never source/execute an environment file.
    values = [line.split("=", 1)[1] for line in path.read_text(encoding="utf-8").splitlines()
              if line.startswith("JWT_SECRET=")]
    if len(values) != 1 or len(values[0]) < 48 or any(
        c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in values[0]
    ):
        raise ValueError("Expected one generated URL-safe JWT_SECRET in the supplied environment file")
    return values[0]


def create_private_files(directory: Path, contents: dict[str, str]) -> None:
    """Publish complete mode-0600 files exclusively via same-filesystem hardlinks.

    Link creation is atomic and refuses existing targets (including symlinks).
    Roll back only files created in this invocation if another target fails.
    """
    if not directory.is_dir():
        raise ValueError("Output directory must already exist; create it with mode 0700")
    for filename in contents:
        if (directory / filename).exists() or (directory / filename).is_symlink():
            raise FileExistsError(f"Refusing to overwrite {filename}")
    created: list[Path] = []
    try:
        for filename, content in contents.items():
            descriptor, temporary = tempfile.mkstemp(prefix=".eink-secret-", dir=directory)
            temporary_path = Path(temporary)
            try:
                os.chmod(temporary_path, 0o600)
                with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
                    output.write(content)
                    output.flush()
                    os.fsync(output.fileno())
                target = directory / filename
                os.link(temporary_path, target)
                created.append(target)
            finally:
                temporary_path.unlink(missing_ok=True)
    except BaseException:
        for target in created:
            target.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--ttl-days", type=int, default=365, help="Service JWT validity, 1-365 days (default: 365)")
    parser.add_argument("--jwt-secret-env", type=Path,
                        help="Renew only backend.env using the signing key in an existing generated .env")
    args = parser.parse_args()
    if not 1 <= args.ttl_days <= 365:
        parser.error("--ttl-days must be between 1 and 365")
    try:
        signing_key = read_signing_key(args.jwt_secret_env) if args.jwt_secret_env else secrets.token_urlsafe(48)
        files = {}
        if args.jwt_secret_env is None:
            example = Path(__file__).with_name(".env.example").read_text(encoding="utf-8")
            values = {
                "POSTGRES_PASSWORD": secrets.token_urlsafe(36),
                "AUTHENTICATOR_PASSWORD": secrets.token_urlsafe(36),
                "JWT_SECRET": signing_key,
            }
            for key, value in values.items():
                placeholder = f"{key}=\n"
                if example.count(placeholder) != 1:
                    raise ValueError(f"Expected exactly one empty {key} placeholder in .env.example")
                example = example.replace(placeholder, f"{key}={value}\n")
            files[".env"] = example
        files["backend.env"] = (
            "# Copy into the backend's server-only environment. Never put in frontend/VITE variables.\n"
            "# Set the HTTPS origin only: Supabase JS appends /rest/v1.\n"
            "SUPABASE_URL=https://REPLACE_WITH_DATABASE_HOSTNAME\n"
            f"SUPABASE_SERVICE_ROLE_KEY={service_jwt(signing_key, args.ttl_days)}\n"
            "# Preserve the backend's exact existing ENCRYPTION_KEY so migrated API keys remain decryptable.\n"
            "# This stack's JWT_SECRET only signs PostgREST credentials; do not replace backend secrets with it.\n"
        )
        create_private_files(args.output_dir, files)
    except (OSError, ValueError) as exc:
        # Errors mention file operations, not file contents or generated secrets.
        print(f"Credential generation failed: {exc}", file=sys.stderr)
        return 1
    print(f"Created {', '.join(files)} with private file permissions. No secret values were printed.")
    print(f"Renew the backend service key before its {args.ttl_days}-day expiry; keep these files securely backed up.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
