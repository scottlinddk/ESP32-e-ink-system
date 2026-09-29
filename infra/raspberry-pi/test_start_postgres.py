"""Exercise storage/startup guards without Docker, disks or service changes."""
import importlib.util
import json
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("storage_guard", Path(__file__).with_name("storage_guard.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakePath(PurePosixPath):
    symlinks = {}
    missing = set()

    def is_mount(self):
        return str(self) in {"/", "/srv", "/srv/esp32-eink"}

    def is_dir(self):
        return self.exists() and not str(self).endswith(".dump")

    def is_file(self):
        return self.exists()

    def exists(self):
        return str(self) not in self.missing

    def resolve(self, strict=False):
        return FakePath(self.symlinks.get(str(self), str(self)))


def container(project, source, *, running=True, service="postgres"):
    return {"Config": {"Labels": {"com.docker.compose.project": project, "com.docker.compose.service": service}},
            "State": {"Running": running}, "Mounts": [{"Source": source, "Destination": "/var/lib/postgresql/data"}]}


class StartupGuardTests(unittest.TestCase):
    def simulate(self, data="/srv/esp32-eink/postgres", *, recovery=False, mounts=(), symlinks=None,
                 uuid="verified-uuid", storage_uuid="verified-uuid", storage_mount="/", filesystems=None,
                 bindings="", active="active", running=False, extra=None, preflight=False,
                 missing=(), work="/srv/esp32-eink/migration", pgconfig="/etc/esp32-eink/pgconfig"):
        called = []
        FakePath.symlinks = symlinks or {}
        FakePath.missing = set(missing)

        def run(command, **kwargs):
            called.append(command)
            if command[:3] == ["docker", "context", "inspect"]:
                output = "unix:///var/run/docker.sock"
            elif command[0] == "findmnt":
                path = command[command.index("--target") + 1]
                record = {"target": "/", "uuid": uuid, "fstype": "ext4", "fsroot": "/"}
                if filesystems and path in filesystems:
                    record.update(filesystems[path])
                output = json.dumps({"filesystems": [record]})
            elif command[0] == "systemd-escape":
                output = "srv-esp32\\x2deink.mount"
            elif command[:2] == ["systemctl", "show"]:
                output = bindings
            elif command[:2] == ["systemctl", "is-active"]:
                output = active
            elif "config" in command:
                services = {"postgres": {"volumes": [{"target": "/var/lib/postgresql/data", "type": "bind", "source": data}],
                                         "environment": {"POSTGRES_PASSWORD": "fixture-secret-never-print"}}}
                # Real Compose omits profile-gated services unless the profile is enabled.
                if "--profile" in command and command[command.index("--profile") + 1] == "tools":
                    services["tools"] = {"volumes": [{"target": "/work", "type": "bind", "source": work},
                                                     {"target": "/run/pgconfig", "type": "bind", "source": pgconfig}]}
                output = json.dumps({"x-eink-storage": {"mount": storage_mount, "uuid": storage_uuid}, "services": services})
            elif command[:3] == ["docker", "ps", "-aq"]:
                output = "fixture-container" if mounts else ""
            elif command[:2] == ["docker", "inspect"]:
                output = json.dumps(mounts)
            elif "up" in command:
                output = ""
            else:
                raise AssertionError(command)
            return SimpleNamespace(stdout=output)

        arguments = ["storage_guard.py", "--env-file", "/etc/esp32-eink/.env", "--ssd-uuid", "verified-uuid"]
        arguments += ["--check-running"] if running else ["--start"]
        if recovery:
            arguments.append("--recovery")
        if extra:
            arguments += ["--extra-path", extra]
        if preflight:
            arguments = ["storage_guard.py", "--preflight", "--ssd-uuid", "verified-uuid", "--storage-mount", storage_mount]
        with patch.object(module, "Path", FakePath), patch("sys.argv", arguments), patch("sys.platform", "linux"), \
             patch.dict("os.environ", {}, clear=True), patch("subprocess.run", run), patch("builtins.print") as printed:
            status = module.main()
            self.assertNotIn("fixture-secret-never-print", str(printed.call_args_list))
        return status, [command for command in called if "up" in command]

    def test_investor_database_path_is_rejected_before_start(self):
        self.assertEqual(self.simulate("/srv/investor/postgres"), (1, []))

    def test_recovery_cannot_use_production_data(self):
        self.assertEqual(self.simulate(recovery=True), (1, []))

    def test_production_cannot_use_recovery_data(self):
        self.assertEqual(self.simulate("/srv/esp32-eink/recovery/trial"), (1, []))

    def test_wrong_ssd_is_rejected(self):
        self.assertEqual(self.simulate(uuid="wrong-uuid"), (1, []))

    def test_persisted_uuid_must_match_explicit_uuid(self):
        self.assertEqual(self.simulate(storage_uuid="another-uuid"), (1, []))

    def test_symlink_data_is_rejected(self):
        self.assertEqual(self.simulate(symlinks={"/srv/esp32-eink/postgres": "/srv/investor/postgres"}), (1, []))

    def test_other_project_parent_mount_is_rejected(self):
        self.assertEqual(self.simulate(mounts=[container("other", "/srv/esp32-eink", running=False)]), (1, []))

    def test_own_postgres_recreation_is_allowed_and_scoped(self):
        status, starts = self.simulate(mounts=[container("esp32-eink", "/srv/esp32-eink/postgres")])
        self.assertEqual(status, 0)
        self.assertEqual(len(starts), 1)
        self.assertIn("--no-deps", starts[0])
        self.assertIn("--force-recreate", starts[0])
        self.assertEqual(starts[0][-1], "postgres")
        self.assertNotIn("--profile", starts[0])
        self.assertEqual(starts[0][starts[0].index("--project-name") + 1], "esp32-eink")

    def test_isolated_recovery_selects_fixed_recovery_project(self):
        status, starts = self.simulate("/srv/esp32-eink/recovery/trial", recovery=True)
        self.assertEqual(status, 0)
        self.assertEqual(starts[0][starts[0].index("--project-name") + 1], "esp32-eink-recovery")

    def test_preflight_accepts_absent_app_directory_on_verified_root_ssd(self):
        self.assertEqual(self.simulate(preflight=True, missing=["/srv/esp32-eink"]), (0, []))

    def test_investor_full_filesystem_alias_is_rejected(self):
        self.assertEqual(self.simulate(filesystems={"/srv/investor": {"target": "/srv/investor", "fsroot": "/"}}), (1, []))

    def test_nonroot_mount_without_docker_boot_guard_is_rejected(self):
        self.assertEqual(self.simulate(storage_mount="/srv/esp32-eink", filesystems={
            "/srv/esp32-eink": {"target": "/srv/esp32-eink"}}), (1, []))

    def test_guarded_separate_mount_is_allowed(self):
        records = {path: {"target": "/srv/esp32-eink", "fsroot": "/"}
                   for path in ("/srv/esp32-eink", "/srv/esp32-eink/postgres", "/srv/esp32-eink/migration")}
        records.update({path: {"uuid": "different-root-uuid"} for path in ("/srv/investor", "/etc/investor")})
        self.assertEqual(self.simulate(storage_mount="/srv/esp32-eink", filesystems=records,
                                      bindings="srv-esp32\\x2deink.mount")[0], 0)

    def test_guarded_bind_alias_into_investor_is_rejected(self):
        records = {path: {"target": "/srv/esp32-eink", "fsroot": "/srv/investor/eink"}
                   for path in ("/srv/esp32-eink", "/srv/esp32-eink/postgres")}
        self.assertEqual(self.simulate(storage_mount="/srv/esp32-eink", filesystems=records,
                                      bindings="srv-esp32\\x2deink.mount"), (1, []))

    def test_backup_requires_actual_running_mount_match(self):
        self.assertEqual(self.simulate(running=True, mounts=[container("esp32-eink", "/srv/esp32-eink/old")]), (1, []))

    def test_backup_checks_storage_before_operation(self):
        self.assertEqual(self.simulate(running=True, uuid="wrong-uuid", extra="/srv/esp32-eink/backups",
                                      mounts=[container("esp32-eink", "/srv/esp32-eink/postgres")]), (1, []))

    def test_backup_rejects_database_as_destination(self):
        self.assertEqual(self.simulate(running=True, extra="/srv/esp32-eink/postgres/backup"), (1, []))

    def test_backup_with_validated_running_storage_passes(self):
        self.assertEqual(self.simulate(running=True, extra="/srv/esp32-eink/backups",
                                      mounts=[container("esp32-eink", "/srv/esp32-eink/postgres")]), (0, []))

    def test_recovery_accepts_archive_on_verified_storage(self):
        data = "/srv/esp32-eink/recovery/trial/postgres"
        self.assertEqual(self.simulate(data, recovery=True, running=True, extra="/srv/esp32-eink/backups/test.dump",
                                      mounts=[container("esp32-eink-recovery", data)]), (0, []))

    def test_backup_rejects_destination_on_another_disk(self):
        self.assertEqual(self.simulate(running=True, extra="/srv/esp32-eink/backups",
                                      filesystems={"/srv/esp32-eink/backups": {"uuid": "wrong-uuid"}}), (1, []))

    def test_migration_work_cannot_use_investor_storage(self):
        self.assertEqual(self.simulate(work="/srv/investor/migration"), (1, []))

    def test_migration_work_cannot_use_database_storage(self):
        self.assertEqual(self.simulate(work="/srv/esp32-eink/postgres/export"), (1, []))

    def test_pgconfig_cannot_use_investor_configuration(self):
        self.assertEqual(self.simulate(pgconfig="/etc/investor/secrets"), (1, []))

    def test_pgconfig_bind_alias_is_rejected(self):
        self.assertEqual(self.simulate(filesystems={"/etc/esp32-eink/pgconfig": {
            "target": "/etc/esp32-eink/pgconfig", "fsroot": "/etc/investor/secrets"}}), (1, []))


if __name__ == "__main__":
    unittest.main()
