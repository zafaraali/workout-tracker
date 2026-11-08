import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import storage
from app import app


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.data_patch = patch.object(storage, "DATA_FILE", Path(self.directory.name) / "workout_data.json")
        self.data_patch.start()
        self.previous_testing = app.config["TESTING"]
        app.config["TESTING"] = True

    def tearDown(self):
        app.config["TESTING"] = self.previous_testing
        self.data_patch.stop()
        self.directory.cleanup()

    def log(self, entry_id):
        with app.test_client() as client:
            return client.post("/log", data={
                "entry_id": entry_id, "date": "2026-11-07", "muscle": "Chest",
                "exercise": "Barbell Bench Press", "weight": "60", "reps": "8",
                "rpe": "7", "unit": "kg", "session_id": "reliability",
            }).status_code

    def test_concurrent_requests_preserve_all_sets_and_deduplicate_retries(self):
        storage.save_data(storage.load_data())
        with ThreadPoolExecutor(max_workers=4) as executor:
            statuses = list(executor.map(self.log, [f"set-{i}" for i in range(12)] * 2))
        self.assertTrue(all(status == 302 for status in statuses))
        self.assertEqual(len(storage.load_data()["workouts"]), 12)

    def test_concurrent_first_launch_migrates_once(self):
        storage.DATA_FILE.write_text(json.dumps({"workouts": [], "exercises": {"Chest": ["Barbell Bench Press"]}}), encoding="utf-8")
        with ThreadPoolExecutor(max_workers=4) as executor:
            statuses = list(executor.map(self.log, [f"first-launch-{i}" for i in range(8)]))
        self.assertTrue(all(status == 302 for status in statuses))
        self.assertEqual(len(storage.load_data()["workouts"]), 8)

    def test_legacy_positional_routes_fail_without_changing_data(self):
        self.log("retained")
        with app.test_client() as client:
            response = client.post("/delete_workout/0")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(storage.load_data()["workouts"]), 1)

    def test_stale_page_targets_id_and_undo_restores_original_order(self):
        for key in ["first", "second", "third"]:
            self.log(key)
        with app.test_client() as client:
            client.post("/sets/first/delete")
            client.post("/sets/third/delete")
            self.assertEqual([s["entry_id"] for s in storage.load_data()["workouts"]], ["second"])
            client.post("/undo_delete_set")
            client.post("/undo_delete_set")
        self.assertEqual([s["entry_id"] for s in storage.load_data()["workouts"]], ["second", "third"])

    def test_damaged_or_newer_mirror_never_replaces_valid_database(self):
        self.log("latest")
        for text in ["{broken", json.dumps({"workouts": [], "exercises": {}})]:
            storage.DATA_FILE.write_text(text, encoding="utf-8")
            self.assertEqual(storage.load_data()["workouts"][0]["entry_id"], "latest")

    def test_damaged_database_recovers_from_backup(self):
        self.log("backed-up")
        self.log("newer")
        storage.database_path().write_bytes(b"damaged database")
        # Recovery must be able to replace the corrupt file, not open it.
        recovered = storage.load_data()
        self.assertEqual(recovered["workouts"][0]["entry_id"], "backed-up")

    def test_transaction_rolls_back_database_and_does_not_publish_mirror(self):
        self.log("retained")
        before = storage.DATA_FILE.read_bytes()
        with self.assertRaises(RuntimeError):
            with storage.write_transaction():
                changed = storage.load_data()
                changed["workouts"] = []
                storage.save_data(changed)
                raise RuntimeError("simulated failure")
        self.assertEqual(storage.load_data()["workouts"][0]["entry_id"], "retained")
        self.assertEqual(storage.DATA_FILE.read_bytes(), before)

    def test_set_update_preserves_database_row(self):
        self.log("stable")
        with closing(sqlite3.connect(storage.database_path())) as connection:
            original_id = connection.execute("SELECT id FROM workouts").fetchone()[0]
        with storage.write_transaction():
            data = storage.load_data()
            data["workouts"][0]["reps"] = "12"
            storage.save_data(data)
        with closing(sqlite3.connect(storage.database_path())) as connection:
            self.assertEqual(connection.execute("SELECT id FROM workouts").fetchone()[0], original_id)
