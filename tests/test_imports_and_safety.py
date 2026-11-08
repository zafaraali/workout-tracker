import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import storage
from app import app


class ImportAndSafetyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.data_patch = patch.object(storage, "DATA_FILE", Path(self.directory.name) / "workout_data.json")
        self.data_patch.start()
        self.testing_patch = patch.dict(app.config, TESTING=True, IRONTRACK_PASSWORD_HASH="")
        self.testing_patch.start()

    def tearDown(self):
        self.testing_patch.stop()
        self.data_patch.stop()
        self.directory.cleanup()

    def test_import_templates_are_available(self):
        with app.test_client() as client:
            response = client.get("/import/template/hevy.csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"duration_seconds", response.data)

    def test_offline_retry_with_changed_values_returns_conflict(self):
        with app.test_client() as client:
            first = client.post("/log", data={
                "entry_id": "offline-set", "date": "2026-11-08", "muscle": "Chest",
                "exercise": "Barbell Bench Press", "weight": "60", "reps": "8",
                "rpe": "7", "unit": "kg", "session_id": "offline",
            }, headers={"X-Offline-Sync": "true"})
            conflict = client.post("/log", data={
                "entry_id": "offline-set", "date": "2026-11-08", "muscle": "Chest",
                "exercise": "Barbell Bench Press", "weight": "65", "reps": "8",
                "rpe": "7", "unit": "kg", "session_id": "offline",
            }, headers={"X-Offline-Sync": "true"})
        self.assertEqual(first.status_code, 201)
        self.assertEqual(conflict.status_code, 409)
        self.assertTrue(conflict.json["conflict"])


if __name__ == "__main__":
    unittest.main()
