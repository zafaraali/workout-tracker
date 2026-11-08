import datetime
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from werkzeug.security import generate_password_hash
import auth
import storage
from app import app
from serve import configure
from training_review import weekly_review


class WeeklyReviewTests(unittest.TestCase):
    def test_week_boundaries_completed_adherence_units_and_records(self):
        today = datetime.date(2026, 11, 7)
        base = {"exercise": "Bench", "reps": "10", "unit": "kg", "finished": True, "routine_id": "r"}
        workouts = [
            dict(base, date="2026-11-01", weight="40", session_id="old"),
            dict(base, date="2026-11-02", weight="50", session_id="one"),
            dict(base, date="2026-11-02", weight="50", session_id="one"),
            dict(base, date="2026-11-04", weight="110.231131", unit="lb", session_id="two"),
            dict(base, date="2026-11-05", weight="200", set_type="warmup", session_id="warmup"),
            dict(base, date="2026-11-06", weight="50", finished=False, session_id="active"),
            dict(base, date="2026-11-08", weight="500", session_id="future"),
            dict(base, date="invalid", weight="500", session_id="invalid"),
        ]
        routines = [{"id": "r", "name": "Upper", "schedule_days": ["0", "2", "6"]}]
        review = weekly_review(workouts, routines, today)
        self.assertEqual(review["start"], "2026-11-02")
        self.assertEqual(review["completed"], 3)
        self.assertEqual(review["in_progress"], 1)
        self.assertEqual(review["due"], 2)  # Sunday is still in the future.
        self.assertEqual(review["matched"], 2)
        self.assertAlmostEqual(review["volume"], 2000)
        self.assertEqual(review["previous_volume"], 400)
        self.assertEqual(len(review["records"]), 1)

    def test_empty_and_first_logged_set_are_baselines(self):
        today = datetime.date(2026, 11, 2)
        self.assertIsNone(weekly_review([], [], today)["volume_change"])
        review = weekly_review([{"date": "2026-11-02", "exercise": "Row", "weight": "50", "reps": "8"}], [], today)
        self.assertEqual(review["records"], [])
        self.assertEqual(review["completed"], 0)


class AccessAndSubstitutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password_hash = generate_password_hash("test-only-long-password", method="scrypt:1024:8:1")

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.file_patch = patch.object(storage, "DATA_FILE", Path(self.directory.name) / "workout_data.json")
        self.file_patch.start()
        self.config_patch = patch.dict(app.config, TESTING=False, IRONTRACK_PASSWORD_HASH=self.password_hash, IRONTRACK_USERNAME="owner")
        self.config_patch.start()
        auth._attempts.clear()
        self.client = app.test_client()

    def tearDown(self):
        self.config_patch.stop()
        self.file_patch.stop()
        self.directory.cleanup()

    def token(self):
        self.client.get("/login")
        with self.client.session_transaction() as state:
            return state["csrf_token"]

    def login(self):
        return self.client.post("/login", data={"username": "owner", "password": "test-only-long-password", "csrf_token": self.token()})

    def test_private_pages_exports_and_writes_require_signin(self):
        self.assertEqual(self.client.get("/").status_code, 302)
        self.assertEqual(self.client.get("/export").location, "/login")
        self.assertEqual(self.client.post("/log", data={}).status_code, 401)
        self.assertEqual(self.client.get("/csrf-token").status_code, 401)
        self.assertEqual(self.client.get("/healthz").status_code, 200)
        self.assertFalse(storage.database_path().exists())

    def test_login_csrf_rotation_logout_and_credential_change(self):
        old_token = self.token()
        rejected = self.client.post("/login", data={"username": "owner", "password": "test-only-long-password"})
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(self.login().status_code, 302)
        new_token = self.client.get("/csrf-token").json["csrf_token"]
        self.assertNotEqual(old_token, new_token)
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.post("/logout").status_code, 400)
        response = self.client.post("/logout", data={"csrf_token": new_token})
        self.assertEqual(response.status_code, 200)
        self.assertIn("storage", response.headers["Clear-Site-Data"])
        self.assertEqual(self.client.get("/").location, "/login")
        self.login()
        app.config["IRONTRACK_PASSWORD_HASH"] = generate_password_hash("new-test-password", method="scrypt:1024:8:1")
        self.assertEqual(self.client.get("/").location, "/login")

    def test_throttle_and_generic_error(self):
        token = self.token()
        for _ in range(5):
            response = self.client.post("/login", data={"username": "wrong", "password": "wrong", "csrf_token": token})
            self.assertEqual(response.status_code, 401)
            self.assertIn(b"Username or password is incorrect", response.data)
        self.assertEqual(self.login().status_code, 429)

    def test_substitution_keeps_plan_link_in_history_and_edits(self):
        self.login()
        data = storage.load_data()
        data["routines"] = [{"id": "r", "name": "Upper", "exercises": [{"muscle": "Chest", "exercise": "Barbell Bench Press", "target_sets": 3, "target_reps": "8"}]}]
        storage.save_data(data)
        token = self.client.get("/csrf-token").json["csrf_token"]
        form = {"csrf_token": token, "date": "2026-11-07", "muscle": "Chest", "exercise": "Incline Dumbbell Press", "weight": "20", "reps": "8", "unit": "kg", "rpe": "7", "routine_id": "r", "routine_slot": "0", "routine_exercise": "Barbell Bench Press"}
        response = self.client.post("/log", data=form, headers={"X-Offline-Sync": "true"})
        self.assertEqual(response.status_code, 201)
        saved = storage.load_data()
        entry = saved["workouts"][0]
        self.assertEqual(entry["routine_exercise"], "Barbell Bench Press")
        self.assertEqual(saved["routines"][0]["exercises"][0]["exercise"], "Barbell Bench Press")
        self.client.post(f"/sets/{entry['entry_id']}/edit", data={**form, "reps": "9"})
        self.assertEqual(storage.load_data()["workouts"][0]["routine_slot"], 0)
        self.assertIn(b"replaces Barbell Bench Press", self.client.get("/?tab=history").data)
        self.assertEqual(self.client.post("/log", data={**form, "routine_slot": "-1"}, headers={"X-Offline-Sync": "true"}).status_code, 400)

    def test_production_entrypoint_refuses_missing_secrets(self):
        with patch.dict(os.environ, {}, clear=True), patch("serve.Path.with_name", return_value=Path(self.directory.name) / "missing.json"):
            with self.assertRaises(RuntimeError):
                configure()
