import json
import tempfile
import unittest
from pathlib import Path

import app as app_module
from exercise_library import DEFAULT_EXERCISES
import storage


class WorkoutFeatureTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_data_file = storage.DATA_FILE
        storage.DATA_FILE = Path(self.temp_dir.name) / "workout_data.json"
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

    def tearDown(self):
        storage.DATA_FILE = self.original_data_file
        self.temp_dir.cleanup()

    def log_set(self, **overrides):
        form = {
            "date": "2026-10-12",
            "muscle": "Chest",
            "exercise": "Barbell Bench Press",
            "weight": "60",
            "unit": "kg",
            "reps": "8",
            "rpe": "7",
            "notes": "Controlled tempo",
            "session_id": "session-1",
            "session_name": "Upper body",
        }
        form.update(overrides)
        return self.client.post("/log", data=form)

    def test_logging_groups_session_and_saves_units_and_notes(self):
        response = self.log_set()
        self.assertEqual(response.status_code, 302)

        data = storage.load_data()
        self.assertEqual(len(data["workouts"]), 1)
        self.assertEqual(data["workouts"][0]["session_name"], "Upper body")
        self.assertEqual(data["workouts"][0]["unit"], "kg")
        self.assertEqual(data["workouts"][0]["notes"], "Controlled tempo")

        history = self.client.get("/?tab=history")
        self.assertIn(b"Upper body", history.data)
        self.assertIn(b"Controlled tempo", history.data)

    def test_edit_and_delete_workout_set(self):
        self.log_set()
        self.log_set(exercise="Incline Dumbbell Press")
        edited = self.client.post(
            "/edit_workout/0",
            data={
                "date": "2026-10-13",
                "session_name": "Strength day",
                "muscle": "Back",
                "exercise": "Barbell Row",
                "weight": "75",
                "unit": "lb",
                "reps": "5",
                "rpe": "8",
                "notes": "Updated note",
            },
        )
        self.assertEqual(edited.status_code, 302)
        workout = storage.load_data()["workouts"][0]
        self.assertEqual(workout["date"], "2026-10-13")
        self.assertEqual(workout["muscle"], "Back")
        self.assertEqual(workout["exercise"], "Barbell Row")
        self.assertEqual(workout["unit"], "lb")
        self.assertEqual(workout["notes"], "Updated note")
        second_workout = storage.load_data()["workouts"][1]
        self.assertEqual(second_workout["date"], "2026-10-13")
        self.assertEqual(second_workout["session_name"], "Strength day")

        deleted = self.client.post("/delete_workout/0")
        self.assertEqual(deleted.status_code, 302)
        self.assertEqual(len(storage.load_data()["workouts"]), 1)

    def test_sets_are_grouped_by_session(self):
        self.log_set()
        self.log_set(exercise="Incline Dumbbell Press")
        self.log_set(session_id="session-2", session_name="Leg day", muscle="Legs", exercise="Leg Press")

        page = self.client.get("/?tab=history")
        self.assertEqual(page.data.count(b"<article"), 2)
        self.assertIn(b"Upper body", page.data)
        self.assertIn(b"Leg day", page.data)

    def test_edit_session_updates_every_set_in_session(self):
        self.log_set()
        self.log_set(exercise="Incline Dumbbell Press")

        response = self.client.post(
            "/edit_session",
            data={
                "session_id": "session-1",
                "original_date": "2026-10-12",
                "session_name": "Push day",
                "date": "2026-10-15",
            },
        )

        self.assertEqual(response.status_code, 302)
        workouts = storage.load_data()["workouts"]
        self.assertEqual([workout["date"] for workout in workouts], ["2026-10-15"] * 2)
        self.assertEqual([workout["session_name"] for workout in workouts], ["Push day"] * 2)

    def test_delete_session_removes_all_its_sets_only(self):
        self.log_set()
        self.log_set(exercise="Incline Dumbbell Press")
        self.log_set(session_id="session-2", session_name="Leg day", muscle="Legs", exercise="Leg Press")

        response = self.client.post(
            "/delete_session",
            data={"session_id": "session-1", "date": "2026-10-12"},
        )

        self.assertEqual(response.status_code, 302)
        remaining = storage.load_data()["workouts"]
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["session_id"], "session-2")

    def test_delete_legacy_session_removes_only_legacy_sets_for_its_date(self):
        data = storage.load_data()
        data["workouts"] = [
            {
                "date": "2025-01-02",
                "muscle": "Chest",
                "exercise": "Barbell Bench Press",
                "weight": "45",
                "reps": "10",
                "rpe": "6",
            },
            {
                "date": "2025-01-02",
                "muscle": "Back",
                "exercise": "Barbell Row",
                "weight": "50",
                "reps": "8",
                "rpe": "7",
                "session_id": "modern-session",
            },
        ]
        storage.save_data(data)

        self.client.post(
            "/delete_session",
            data={"session_id": "legacy:2025-01-02", "date": "2025-01-02"},
        )

        remaining = storage.load_data()["workouts"]
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["session_id"], "modern-session")

    def test_restore_default_library_keeps_workout_history(self):
        self.log_set()
        data = storage.load_data()
        data["exercises"]["Chest"].remove("Barbell Bench Press")
        data["exercises"]["Custom"] = ["Custom Lift"]
        storage.save_data(data)

        response = self.client.post("/restore_exercise_library")

        self.assertEqual(response.status_code, 302)
        restored = storage.load_data()
        self.assertEqual(restored["exercises"], DEFAULT_EXERCISES)
        self.assertEqual(len(restored["workouts"]), 1)

    def test_routine_can_be_saved_from_session(self):
        self.log_set()
        self.log_set(exercise="Incline Dumbbell Press")

        response = self.client.post(
            "/save_routine",
            data={"session_id": "session-1", "name": "Upper A"},
        )

        self.assertEqual(response.status_code, 302)
        routines = storage.load_data()["routines"]
        self.assertEqual(len(routines), 1)
        self.assertEqual(routines[0]["name"], "Upper A")
        self.assertEqual(
            [item["exercise"] for item in routines[0]["exercises"]],
            ["Barbell Bench Press", "Incline Dumbbell Press"],
        )

    def test_measurement_entry_is_saved_and_rendered(self):
        response = self.client.post(
            "/save_measurement",
            data={
                "date": "2026-10-12",
                "body_weight": "82.5",
                "unit": "kg",
                "waist": "84",
                "chest": "",
                "hips": "",
                "notes": "Morning measurement",
            },
        )

        self.assertEqual(response.status_code, 302)
        page = self.client.get("/?tab=measurements")
        self.assertIn(b"82.5", page.data)
        self.assertIn(b"Morning measurement", page.data)

    def test_measurement_can_be_updated_and_deleted(self):
        self.client.post(
            "/save_measurement",
            data={"date": "2026-10-12", "body_weight": "82.5", "unit": "kg", "waist": "84"},
        )
        measurement_id = storage.load_data()["measurements"][0]["id"]
        updated = self.client.post(
            f"/update_measurement/{measurement_id}",
            data={
                "date": "2026-10-13",
                "body_weight": "80",
                "unit": "kg",
                "waist": "82",
                "chest": "",
                "hips": "",
                "notes": "Updated",
            },
        )
        self.assertEqual(updated.status_code, 302)
        self.assertEqual(storage.load_data()["measurements"][0]["date"], "2026-10-13")
        self.assertEqual(storage.load_data()["measurements"][0]["waist"], "82")
        self.client.post(f"/delete_measurement/{measurement_id}")
        self.assertEqual(storage.load_data()["measurements"], [])

    def test_legacy_measurement_without_id_can_be_deleted(self):
        data = storage.load_data()
        data["measurements"].append(
            {
                "date": "2025-01-02",
                "body_weight": "80",
                "unit": "kg",
                "waist": "82",
                "chest": "",
                "hips": "",
                "notes": "",
            }
        )
        storage.save_data(data)

        self.client.post("/delete_measurement/legacy-measurement-0")

        self.assertEqual(storage.load_data()["measurements"], [])

    def test_routine_targets_can_be_created_and_edited(self):
        routine_data = json.dumps([
            {
                "muscle": "Chest",
                "exercise": "Barbell Bench Press",
                "target_sets": "4",
                "target_reps": "6-8",
                "target_weight": "60",
                "rest_seconds": "120",
                "notes": "Pause reps",
            }
        ])
        self.client.post(
            "/save_routine",
            data={"mode": "builder", "name": "Strength A", "exercises_json": routine_data},
        )
        routine = storage.load_data()["routines"][0]
        self.assertEqual(routine["exercises"][0]["target_sets"], 4)
        self.assertEqual(routine["exercises"][0]["rest_seconds"], 120)

        updated_data = routine_data.replace('"target_sets": "4"', '"target_sets": "5"')
        response = self.client.post(
            f"/update_routine/{routine['id']}",
            data={"name": "Strength B", "exercises_json": updated_data},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(storage.load_data()["routines"][0]["name"], "Strength B")
        self.assertEqual(storage.load_data()["routines"][0]["exercises"][0]["target_sets"], 5)

    def test_save_creates_recoverable_automatic_backup(self):
        data = storage.load_data()
        data["workouts"].append({"date": "2026-10-12", "exercise": "Barbell Bench Press"})
        storage.save_data(data)
        changed = storage.load_data()
        changed["workouts"].append({"date": "2026-10-13", "exercise": "Barbell Row"})
        storage.save_data(changed)
        self.assertEqual(len(storage.automatic_backups()), 1)

        storage.DATA_FILE.write_text("{damaged", encoding="utf-8")
        recovered = storage.load_data()
        self.assertEqual(len(recovered["workouts"]), 1)
        self.assertEqual(recovered["workouts"][0]["date"], "2026-10-12")

    def test_log_request_with_same_entry_id_is_idempotent(self):
        self.log_set(entry_id="offline-entry-1")
        self.log_set(entry_id="offline-entry-1")
        self.assertEqual(len(storage.load_data()["workouts"]), 1)

    def test_offline_sync_endpoint_reports_validation_failures(self):
        response = self.client.post(
            "/log",
            data={
                "date": "invalid",
                "muscle": "Chest",
                "exercise": "Barbell Bench Press",
                "weight": "60",
                "unit": "kg",
                "reps": "8",
                "rpe": "7",
                "entry_id": "queued-entry",
            },
            headers={"X-Offline-Sync": "true"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json["ok"])
        self.assertEqual(storage.load_data()["workouts"], [])

    def test_installable_app_assets_are_served(self):
        worker = self.client.get("/service-worker.js")
        manifest = self.client.get("/static/manifest.json")
        self.assertEqual(worker.status_code, 200)
        self.assertIn(b"irontrack-shell", worker.data)
        self.assertEqual(manifest.status_code, 200)
        self.assertIn(b"standalone", manifest.data)
        worker.close()
        manifest.close()

    def test_cardio_set_accepts_distance_and_duration_without_reps(self):
        response = self.log_set(
            set_type="cardio",
            weight="",
            reps="",
            rpe="",
            distance="5.2",
            distance_unit="km",
            duration="30",
        )

        self.assertEqual(response.status_code, 302)
        workout = storage.load_data()["workouts"][0]
        self.assertEqual(workout["set_type"], "cardio")
        self.assertEqual(workout["distance"], "5.2")
        self.assertEqual(workout["duration"], "30")

    def test_history_contains_calendar_and_in_progress_tab_renders(self):
        self.log_set()
        history = self.client.get("/?tab=history&month=2026-10")
        self.assertIn(b"October 2026", history.data)
        self.assertIn(b"calendar-day-active", history.data)

        active = self.client.get("/?tab=log&session_id=session-1")
        self.assertIn(b"Workout in progress", active.data)
        self.assertIn(b"Barbell Bench Press", active.data)

    def test_invalid_workout_input_is_not_saved(self):
        self.log_set(weight="NaN")
        self.assertEqual(storage.load_data()["workouts"], [])
        self.log_set(unit="stone")
        self.assertEqual(storage.load_data()["workouts"], [])

    def test_progress_view_embeds_existing_workout_data(self):
        self.log_set()
        response = self.client.get("/?tab=progress")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Exercise Progress", response.data)
        self.assertIn(b"renderProgressChart", response.data)
        self.assertIn(b"Controlled tempo", response.data)

    def test_library_has_search_and_category_filters_and_set_notes_input(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="library-search"', response.data)
        self.assertIn(b'id="library-category-filter"', response.data)
        self.assertIn(b'id="library-no-results"', response.data)
        self.assertIn(b'name="notes"', response.data)
        self.assertIn(b"Set notes", response.data)

    def test_accent_color_picker_is_available(self):
        response = self.client.get("/")
        self.assertIn(b'id="accent-color"', response.data)
        self.assertIn(b'onchange="setAccentColor(this.value)"', response.data)
        self.assertIn(b'document.getElementById("accent-color").value = savedAccentPicker', response.data)
        self.assertIn(b'id="reset-accent"', response.data)

    def test_legacy_backup_workout_without_optional_fields_loads(self):
        legacy = {
            "workouts": [{
                "date": "2025-01-02",
                "muscle": "Chest",
                "exercise": "Barbell Bench Press",
                "weight": "45",
                "reps": "10",
                "rpe": "6",
            }],
            "exercises": {"Chest": ["Barbell Bench Press"]},
        }
        storage.DATA_FILE.write_text(json.dumps(legacy), encoding="utf-8")

        page = self.client.get("/?tab=history")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"45 kg", page.data)
        self.assertIn(b"Workout", page.data)


if __name__ == "__main__":
    unittest.main()
