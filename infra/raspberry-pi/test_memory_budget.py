"""Physical-memory admission tests; no Docker or host state is changed."""
import importlib.util
from decimal import Decimal
import json
from pathlib import Path
from unittest.mock import patch
import unittest

spec = importlib.util.spec_from_file_location("memory_budget", Path(__file__).with_name("memory_budget.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
MIB = module.MIB


def container(service, limit, project="investor", identifier=None, **extra):
    return {"id": identifier or service, "service": service, "project": project,
            "limit": limit * MIB, "running": True, "oneoff": "False", **extra}


def investor():
    return [container("postgres", 1024), container("api", 512), container("worker", 320)]


def measured(items, usage=0):
    return {item["id"]: usage * MIB for item in items}


class MemoryAdmissionTests(unittest.TestCase):
    def test_pi4_with_investor_fits_at_realistic_working_set(self):
        items = investor()
        result = module.budget(3800 * MIB, 3000 * MIB, items, measured(items, 200))
        self.assertTrue(result["passes"])
        self.assertEqual(result["total_required"], 3680 * MIB)
        self.assertEqual(result["available_required"], 2824 * MIB)

    def test_total_boundary_and_one_byte_short(self):
        items = investor()
        readings = measured(items, 200)
        self.assertTrue(module.budget(3680 * MIB, 3000 * MIB, items, readings)["passes"])
        self.assertFalse(module.budget(3680 * MIB - 1, 3000 * MIB, items, readings)["passes"])

    def test_available_boundary_and_one_byte_short(self):
        items = investor()
        readings = measured(items, 200)
        self.assertTrue(module.budget(3800 * MIB, 2824 * MIB, items, readings)["passes"])
        self.assertFalse(module.budget(3800 * MIB, 2824 * MIB - 1, items, readings)["passes"])

    def test_missing_investor_services_remain_reserved(self):
        items = [container("postgres", 1024)]
        result = module.budget(3800 * MIB, 3400 * MIB, items, measured(items, 100))
        self.assertEqual(result["total_required"], 3680 * MIB)
        self.assertEqual(result["missing_caps"], (512 + 320 + 544) * MIB)

    def test_no_containers_still_reserves_investor(self):
        result = module.budget(3800 * MIB, 3500 * MIB, [], {})
        self.assertEqual(result["total_required"], 3680 * MIB)
        self.assertEqual(result["available_required"], 3424 * MIB)
        self.assertTrue(result["passes"])

    def test_existing_eink_services_are_not_double_counted(self):
        items = investor() + [container(name, limit // MIB, "esp32-eink", "eink-" + name)
                              for name, limit in module.EINK.items()]
        result = module.budget(3800 * MIB, 3300 * MIB, items, measured(items, 10))
        self.assertEqual(result["total_required"], 3680 * MIB)
        self.assertEqual(result["missing_caps"], 0)

    def test_actual_larger_caps_count_and_can_refuse_pi4(self):
        items = investor()
        items[0]["limit"] = 1536 * MIB
        result = module.budget(3800 * MIB, 3600 * MIB, items, measured(items, 200))
        self.assertEqual(result["total_required"], 4192 * MIB)
        self.assertFalse(result["passes"])

    def test_smaller_actual_investor_caps_do_not_erase_floor(self):
        items = investor()
        items[0]["limit"] = 512 * MIB
        self.assertEqual(module.budget(3800 * MIB, 3000 * MIB, items, measured(items, 100))["total_required"],
                         3680 * MIB)

    def test_unknown_capped_container_counts_toward_host_capacity(self):
        items = investor() + [container("other", 256, "other")]
        result = module.budget(3800 * MIB, 3500 * MIB, items, measured(items, 100))
        self.assertEqual(result["total_required"], 3936 * MIB)
        self.assertFalse(result["passes"])

    def test_idle_containers_still_need_room_to_grow(self):
        items = investor()
        result = module.budget(3800 * MIB, 2700 * MIB, items, measured(items, 10))
        self.assertFalse(result["passes"])
        self.assertEqual(result["running_growth"], 1826 * MIB)

    def test_uncapped_unknown_container_refused(self):
        items = [container("other", 0, "other")]
        with self.assertRaisesRegex(ValueError, "ceiling"):
            module.budget(8000 * MIB, 7000 * MIB, items, measured(items))

    def test_unrelated_project_with_same_service_name_is_not_deduplicated(self):
        items = [container("postgres", 384, "different")]
        result = module.budget(8000 * MIB, 7000 * MIB, items, measured(items))
        self.assertEqual(result["total_required"], 4064 * MIB)

    def test_active_oneoff_and_known_maintenance_refused(self):
        cases = [container("api", 512, oneoff="True"), container("migrate", 512),
                 container("tools", 256, "esp32-eink"), container("postgres", 384, "esp32-eink-recovery")]
        for item in cases:
            with self.subTest(item=item), self.assertRaisesRegex(ValueError, "maintenance"):
                module.budget(8000 * MIB, 7000 * MIB, [item], measured([item]))

    def test_duplicate_known_service_refused(self):
        items = [container("api", 512), container("api", 512, identifier="api2")]
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            module.budget(8000 * MIB, 7000 * MIB, items, measured(items))

    def test_missing_extra_and_implausible_stats_refused(self):
        items = [container("api", 512)]
        for readings in ({}, {"api": 0, "extra": 0}, {"api": 513 * MIB}, {"api": -1}):
            with self.subTest(readings=readings), self.assertRaises(ValueError):
                module.budget(8000 * MIB, 7000 * MIB, items, readings)

    def test_stopped_container_refused(self):
        items = [container("api", 512, running=False)]
        with self.assertRaisesRegex(ValueError, "changed"):
            module.budget(8000 * MIB, 7000 * MIB, items, measured(items))


class MemoryInputTests(unittest.TestCase):
    def test_meminfo_uses_available_physical_ram_and_ignores_swap(self):
        self.assertEqual(module.meminfo("MemTotal: 4000 kB\nMemAvailable: 3000 kB\nSwapFree: 99999999 kB\n"),
                         (4000 * 1024, 3000 * 1024))

    def test_missing_malformed_duplicate_or_impossible_meminfo_refused(self):
        for content in ("MemTotal: 4 kB", "MemTotal: 4 kB\nMemAvailable: 5 kB", "MemTotal: 4 B\nMemAvailable: 1 kB",
                        "MemTotal: 4 kB\nMemTotal: 4 kB\nMemAvailable: 1 kB", "MemTotal: 0 kB\nMemAvailable: 0 kB"):
            with self.subTest(content=content), self.assertRaises(ValueError):
                module.meminfo(content)

    def test_docker_display_rounding_never_overcredits_usage(self):
        self.assertEqual(module.working_set_lower_bound("200.0MiB / 1GiB"), int(199.9 * MIB))
        self.assertEqual(module.working_set_lower_bound("0B / 1GiB"), 0)
        self.assertEqual(module.working_set_lower_bound("1.5GiB / 2GiB"), int(Decimal("1.4") * 1024 * MIB))

    def test_unrecognized_or_malformed_stats_refused(self):
        for reading in (None, "20MB / 1GB", "N/A / N/A", "-1MiB / 1GiB", "1MiB"):
            with self.subTest(reading=reading), self.assertRaises(ValueError):
                module.working_set_lower_bound(reading)

    def inventory(self, *, states=None, ids=None, changed=False, stats=None,
                  cap_support="true", remote=False):
        identifier = "a" * 64
        ids = [identifier] if ids is None else ids
        states = "\n\n".join(["inactive"] * len(module.MAINTENANCE_UNITS)) if states is None else states
        item = container("api", 512, identifier=identifier)
        calls = []
        ps_calls = 0

        def read(command):
            nonlocal ps_calls
            calls.append(command)
            if command[:3] == ["docker", "context", "inspect"]:
                return "ssh://remote" if remote else "unix:///var/run/docker.sock"
            if command[:2] == ["docker", "info"]:
                return cap_support
            if command[:2] == ["systemctl", "show"]:
                return states
            if command[:2] == ["docker", "ps"]:
                ps_calls += 1
                return "\n".join([] if changed and ps_calls > 1 else ids)
            if command[:2] == ["docker", "inspect"]:
                return json.dumps(item)
            if command[:2] == ["docker", "stats"]:
                return stats if stats is not None else json.dumps({"id": identifier, "memory": "100.0MiB / 512MiB"})
            raise AssertionError(command)

        with patch.object(module, "read", side_effect=read), patch.object(module.sys, "platform", "linux"), \
                patch.dict(module.os.environ, {}, clear=True):
            result = module.local_inventory()
        return result, calls

    def test_inventory_reads_only_safe_inspect_fields(self):
        result, calls = self.inventory()
        self.assertEqual(len(result[0]), 1)
        inspect = next(call for call in calls if call[:2] == ["docker", "inspect"])
        self.assertEqual(inspect[2:4], ["--format", module.INSPECT_FORMAT])
        self.assertNotIn(".Env", module.INSPECT_FORMAT)
        self.assertEqual({call[0] for call in calls}, {"docker", "systemctl"})

    def test_no_running_containers(self):
        self.assertEqual(self.inventory(ids=[])[0], ([], {}))

    def test_inventory_refuses_active_maintenance_remote_or_unsupported_limits(self):
        for kwargs in ({"states": "active\ninactive\ninactive"}, {"remote": True}, {"cap_support": "false"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.inventory(**kwargs)

    def test_each_real_investor_maintenance_unit_is_checked(self):
        self.assertIn("investor-auto-update.service", module.MAINTENANCE_UNITS)
        self.assertIn("investor-update-request.service", module.MAINTENANCE_UNITS)
        for index in range(len(module.MAINTENANCE_UNITS)):
            states = ["inactive"] * len(module.MAINTENANCE_UNITS)
            states[index] = "activating"
            with self.subTest(unit=module.MAINTENANCE_UNITS[index]), self.assertRaisesRegex(ValueError, "maintenance"):
                self.inventory(states="\n".join(states))

    def test_inventory_refuses_container_race(self):
        with self.assertRaisesRegex(ValueError, "changed"):
            self.inventory(changed=True)

    def test_inventory_refuses_missing_stats(self):
        with self.assertRaisesRegex(ValueError, "changed"):
            self.inventory(stats="")

    def test_inventory_refuses_oversized_container_list(self):
        with self.assertRaisesRegex(ValueError, "list"):
            self.inventory(ids=[f"{index:064x}" for index in range(module.MAX_CONTAINERS + 1)])


if __name__ == "__main__":
    unittest.main()
