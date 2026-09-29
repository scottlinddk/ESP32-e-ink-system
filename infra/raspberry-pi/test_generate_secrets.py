"""Offline credential tests; never connects to Docker, a database, or the Pi."""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("generate_secrets", Path(__file__).with_name("generate-secrets.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CredentialTests(unittest.TestCase):
    def test_backend_output_uses_application_environment_names(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("sys.argv", ["generate-secrets.py", "--output-dir", directory]), patch("builtins.print"):
                self.assertEqual(module.main(), 0)
            result = (Path(directory) / "backend.env").read_text()
            self.assertIn("SUPABASE_SERVICE_ROLE_KEY=", result)
            self.assertNotIn("SUPABASE_SERVICE_KEY=", result)
            self.assertIn("exact existing ENCRYPTION_KEY", result)

    def test_jwt_signature_role_audience_and_expiration(self):
        secret = "test-key-" * 8
        token = module.service_jwt(secret, 90, now=1800000000)
        header, body, signature = token.split(".")
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        self.assertEqual(claims["role"], "service_role")
        self.assertEqual(claims["aud"], "esp32-eink-backend")
        self.assertEqual(claims["exp"], 1800000000 + 90 * 86400)
        expected = module.encode(hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest())
        self.assertTrue(hmac.compare_digest(signature, expected))

    def test_existing_file_refuses_entire_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "backend.env").write_text("original", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                module.create_private_files(path, {".env": "new", "backend.env": "replacement"})
            self.assertEqual((path / "backend.env").read_text(), "original")
            self.assertFalse((path / ".env").exists())

    def test_private_complete_files_and_no_staging_remains(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            module.create_private_files(path, {".env": "A=secret\n", "backend.env": "B=value\n"})
            self.assertEqual((path / ".env").read_text(), "A=secret\n")
            self.assertEqual(sorted(p.name for p in path.iterdir()), [".env", "backend.env"])
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE((path / ".env").stat().st_mode), 0o600)

    def test_renewal_key_parser_rejects_shell_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("JWT_SECRET=$(arbitrary shell content)\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                module.read_signing_key(path)
            path.write_text("JWT_SECRET=" + "a" * 64 + "\n", encoding="utf-8")
            self.assertEqual(module.read_signing_key(path), "a" * 64)


if __name__ == "__main__":
    unittest.main()
