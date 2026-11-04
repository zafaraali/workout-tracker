import json
import io
import datetime
import tempfile
import unittest
from pathlib import Path

import app as app_module
from exercise_library import DEFAULT_EXERCISES
from routes import _training_insights
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

    def test_backup_preview_is_non_mutating_and_supports_merge_or_replace(self):
        current = storage.load_data()
        current["workouts"] = [{
            "entry_id": "same", "date": "2026-10-12", "muscle": "Chest",
            "exercise": "Barbell Bench Press", "weight": "60", "reps": "8",
        }]
        current["routines"] = [{"id": "current-routine", "name": "Existing", "exercises": []}]
        storage.save_data(current)
        backup = {
            "workouts": [
                {
                    "entry_id": "same", "date": "2026-10-12", "muscle": "Chest",
                    "exercise": "Barbell Bench Press", "weight": "60", "reps": "8",
                },
                {
                    "entry_id": "new", "date": "2026-10-13", "muscle": "Chest",
                    "exercise": "Barbell Bench Press", "weight": "62.5", "reps": "8",
                },
            ],
            "exercises": {
                **DEFAULT_EXERCISES,
                "Chest": [*DEFAULT_EXERCISES["Chest"], "Cable Fly"],
            },
            "routines": [
                {"id": "backup-routine", "name": "Existing", "exercises": []},
                {"id": "new-routine", "name": "New", "exercises": []},
            ],
            "measurements": [],
            "goals": [],
        }
        backup_json = json.dumps(backup)
        preview = self.client.post(
            "/import",
            data={"backup_file": (io.BytesIO(backup_json.encode()), "backup.json")},
        )
        self.assertEqual(preview.status_code, 200)
        self.assertIn(b"Review backup import", preview.data)
        self.assertIn(b"No missing sections", preview.data)
        self.assertEqual(storage.load_data(), current)

        merged_response = self.client.post(
            "/import/confirm",
            data={"backup_json": backup_json, "mode": "merge"},
        )
        self.assertEqual(merged_response.status_code, 302)
        merged = storage.load_data()
        self.assertEqual([item["entry_id"] for item in merged["workouts"]], ["same", "new"])
        self.assertEqual(merged["routines"], [
            {"id": "current-routine", "name": "Existing", "exercises": []},
            {"id": "new-routine", "name": "New", "exercises": []},
        ])
        self.assertIn("Cable Fly", merged["exercises"]["Chest"])

        self.client.post(
            "/import",
            data={"backup_file": (io.BytesIO(backup_json.encode()), "backup.json")},
        )
        replaced_response = self.client.post(
            "/import/confirm",
            data={"backup_json": backup_json, "mode": "replace"},
        )
        self.assertEqual(replaced_response.status_code, 302)
        replaced = storage.load_data()
        self.assertEqual([item["entry_id"] for item in replaced["workouts"]], ["same", "new"])
        self.assertEqual([item["id"] for item in replaced["routines"]], ["backup-routine", "new-routine"])

    def test_invalid_backup_preview_does_not_change_existing_data(self):
        existing = storage.load_data()
        existing["workouts"] = [{"entry_id": "keep"}]
        storage.save_data(existing)
        invalid_backups = [
            b'{"workouts": [], "exercises": []}',
            json.dumps({
                "workouts": [{
                    "date": "not-a-date", "muscle": "Chest",
                    "exercise": "Bench", "weight": "50", "reps": "8",
                }],
                "exercises": DEFAULT_EXERCISES,
            }).encode(),
            b'{"workouts": [], "exercises": {}, "routines": [], "measurements": [], "goals": [], "extra": NaN}',
        ]
        for invalid_backup in invalid_backups:
            response = self.client.post(
                "/import",
                data={"backup_file": (io.BytesIO(invalid_backup), "bad.json")},
            )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(storage.load_data(), existing)

    def test_routine_link_is_saved_and_retained_when_editing_a_set(self):
        routine_response = self.client.post(
            "/save_routine",
            data={
                "mode": "builder",
                "name": "Upper body",
                "exercises_json": json.dumps([{
                    "muscle": "Chest",
                    "exercise": "Barbell Bench Press",
                    "target_sets": "3",
                    "target_reps": "8",
                }]),
            },
        )
        self.assertEqual(routine_response.status_code, 302)
        routine_id = storage.load_data()["routines"][0]["id"]
        self.log_set(session_id="routine-session", routine_id=routine_id)
        self.assertEqual(storage.load_data()["workouts"][0]["routine_id"], routine_id)

        self.client.post(
            "/edit_workout/0",
            data={
                "date": "2026-10-12",
                "session_name": "Upper body",
                "muscle": "Chest",
                "exercise": "Barbell Bench Press",
                "weight": "65",
                "unit": "kg",
                "reps": "8",
                "rpe": "7",
            },
        )
        self.assertEqual(storage.load_data()["workouts"][0]["routine_id"], routine_id)
        page = self.client.get("/?tab=routines")
        self.assertIn(b"Compare sessions", page.data)
        self.assertIn(routine_id.encode(), page.data)

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
                "warmup_sets": "2",
                "warmup_weight": "30",
                "target_reps": "6-8",
                "target_weight": "60",
                "weight_increment": "2.5",
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
        self.assertEqual(routine["exercises"][0]["warmup_sets"], 2)
        self.assertEqual(routine["exercises"][0]["warmup_weight"], "30.0")
        self.assertEqual(routine["exercises"][0]["weight_increment"], "2.5")
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

    def test_workout_duration_and_superset_are_saved_and_displayed(self):
        self.log_set(elapsed_seconds="125", superset_group="A")
        page = self.client.get("/?tab=log&session_id=session-1")
        self.assertIn(b"data-elapsed=\"125\"", page.data)
        self.assertIn(b"Group A", page.data)
        self.assertEqual(storage.load_data()["workouts"][0]["superset_group"], "A")

    def test_session_can_reorder_exercises_and_assign_supersets(self):
        self.log_set()
        self.log_set(exercise="Incline Dumbbell Press")
        response = self.client.post(
            "/update_session_structure",
            data={
                "session_id": "session-1",
                "exercise_order": json.dumps(["Incline Dumbbell Press", "Barbell Bench Press"]),
                "superset_groups": json.dumps({
                    "Incline Dumbbell Press": "A",
                    "Barbell Bench Press": "A",
                }),
            },
        )
        self.assertEqual(response.status_code, 302)
        data = storage.load_data()["workouts"]
        self.assertEqual(
            [item["exercise"] for item in data],
            ["Incline Dumbbell Press", "Barbell Bench Press"],
        )
        self.assertEqual({item["superset_group"] for item in data}, {"A"})

    def test_finishing_workout_persists_total_duration(self):
        self.log_set(elapsed_seconds="60")
        self.log_set(elapsed_seconds="150")
        response = self.client.post(
            "/finish_session",
            data={"session_id": "session-1", "elapsed_seconds": "180"},
        )
        self.assertEqual(response.status_code, 302)
        workouts = storage.load_data()["workouts"]
        self.assertEqual([item["elapsed_seconds"] for item in workouts], [180, 180])
        self.assertTrue(all(item["finished"] for item in workouts))
        history = self.client.get("/?tab=history")
        self.assertIn(b"03:00", history.data)

    def test_csv_exports_include_rows_and_protect_formula_values(self):
        data = storage.load_data()
        data["exercises"]["Chest"].append("=IMPORTDATA(\"https://example.test\")")
        storage.save_data(data)
        self.log_set(exercise="=IMPORTDATA(\"https://example.test\")")
        workouts = self.client.get("/export/workouts.csv")
        self.assertEqual(workouts.status_code, 200)
        self.assertIn(b"'=IMPORTDATA", workouts.data)
        self.assertIn(b"elapsed_seconds", workouts.data)
        self.client.post(
            "/save_measurement",
            data={
                "date": "2026-10-12",
                "body_weight": "82",
                "unit": "kg",
                "waist": "84",
                "notes": "=SUM(1,1)",
            },
        )
        measurements = self.client.get("/export/measurements.csv")
        self.assertEqual(measurements.status_code, 200)
        self.assertIn(b"'=SUM(1,1)", measurements.data)

    def test_goal_progress_uses_measurements_and_goal_can_be_deleted(self):
        self.client.post(
            "/save_measurement",
            data={"date": "2026-10-01", "body_weight": "80", "unit": "kg"},
        )
        response = self.client.post(
            "/save_goal",
            data={
                "metric": "body_weight",
                "target": "75",
                "unit": "kg",
                "direction": "decrease",
                "target_date": "2026-12-01",
            },
        )
        self.assertEqual(response.status_code, 302)
        goal = storage.load_data()["goals"][0]
        self.assertEqual(goal["baseline"], "80")
        self.client.post(
            "/save_measurement",
            data={"date": "2026-10-15", "body_weight": "78", "unit": "kg"},
        )
        page = self.client.get("/?tab=measurements")
        self.assertIn(b"Current: 78.0 kg", page.data)
        self.assertIn(b"40% there", page.data)
        self.client.post(f"/delete_goal/{goal['id']}")
        self.assertEqual(storage.load_data()["goals"], [])

    def test_goal_rejects_non_weight_increase_and_legacy_data_has_goals_default(self):
        response = self.client.post(
            "/save_goal",
            data={"metric": "waist", "target": "70", "unit": "cm", "direction": "increase"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(storage.load_data()["goals"], [])
        legacy = {"workouts": [], "exercises": {}}
        storage.DATA_FILE.write_text(json.dumps(legacy), encoding="utf-8")
        self.assertEqual(storage.load_data()["goals"], [])

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

    def test_duplicate_workout_creates_a_fresh_unfinished_session(self):
        self.log_set()
        self.log_set(exercise="Incline Dumbbell Press", elapsed_seconds="180")
        data = storage.load_data()
        for workout in data["workouts"]:
            workout["elapsed_seconds"] = 180
            workout["finished"] = True
        storage.save_data(data)

        response = self.client.post(
            "/duplicate_session",
            data={"session_id": "session-1", "date": "2026-10-20"},
        )

        self.assertEqual(response.status_code, 302)
        workouts = storage.load_data()["workouts"]
        self.assertEqual(len(workouts), 4)
        copied = workouts[2:]
        self.assertTrue(all(item["date"] == "2026-10-20" for item in copied))
        self.assertEqual(len({item["session_id"] for item in copied}), 1)
        self.assertNotEqual(copied[0]["session_id"], "session-1")
        self.assertTrue(all(item["elapsed_seconds"] == 0 for item in copied))
        self.assertTrue(all(not item["finished"] for item in copied))
        self.assertEqual(len({item["entry_id"] for item in workouts}), 4)

    def test_duplicate_single_set_and_reject_invalid_target_date(self):
        self.log_set()
        invalid = self.client.post(
            "/duplicate_workout/0",
            data={"date": "not-a-date"},
        )
        self.assertEqual(invalid.status_code, 302)
        self.assertEqual(len(storage.load_data()["workouts"]), 1)

        response = self.client.post(
            "/duplicate_workout/0",
            data={"date": "2026-10-20"},
        )
        workouts = storage.load_data()["workouts"]
        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(workouts), 2)
        self.assertEqual(workouts[1]["exercise"], workouts[0]["exercise"])
        self.assertEqual(workouts[1]["date"], "2026-10-20")
        self.assertNotEqual(workouts[1]["session_id"], workouts[0]["session_id"])
        self.assertNotEqual(workouts[1]["entry_id"], workouts[0]["entry_id"])

    def test_routines_and_goals_have_separate_import_export(self):
        routine_file = json.dumps([
            {
                "name": "Upper A",
                "exercises": [{
                    "muscle": "Chest",
                    "exercise": "Barbell Bench Press",
                    "target_sets": 4,
                    "target_reps": "6-8",
                    "target_weight": "60",
                    "rest_seconds": 120,
                    "notes": "Pause reps",
                }],
            }
        ])
        imported_routines = self.client.post(
            "/import/routines",
            data={"routines_file": (io.BytesIO(routine_file.encode()), "routines.json")},
        )
        self.assertEqual(imported_routines.status_code, 302)
        saved_routine = storage.load_data()["routines"][0]
        self.assertEqual(saved_routine["name"], "Upper A")
        self.assertEqual(saved_routine["exercises"][0]["target_sets"], 4)

        goal_file = json.dumps([{
            "metric": "body_weight",
            "target": "75",
            "unit": "kg",
            "direction": "decrease",
            "target_date": "2027-01-01",
            "baseline": "80",
            "baseline_unit": "kg",
        }])
        imported_goals = self.client.post(
            "/import/goals",
            data={"goals_file": (io.BytesIO(goal_file.encode()), "goals.json")},
        )
        self.assertEqual(imported_goals.status_code, 302)
        saved_goal = storage.load_data()["goals"][0]
        self.assertEqual(saved_goal["target"], "75.0")
        self.assertEqual(saved_goal["baseline"], "80.0")

        routines_export = self.client.get("/export/routines.json")
        goals_export = self.client.get("/export/goals.json")
        self.assertEqual(routines_export.status_code, 200)
        self.assertEqual(json.loads(routines_export.data)[0]["name"], "Upper A")
        self.assertEqual(goals_export.status_code, 200)
        self.assertEqual(json.loads(goals_export.data)[0]["metric"], "body_weight")

    def test_invalid_routine_or_goal_import_preserves_existing_data(self):
        data = storage.load_data()
        data["routines"] = [{"id": "existing-routine", "name": "Existing", "exercises": []}]
        data["goals"] = [{
            "id": "existing-goal",
            "metric": "waist",
            "target": "70",
            "unit": "cm",
            "direction": "decrease",
        }]
        storage.save_data(data)
        bad_routine = json.dumps([{"name": "Broken", "exercises": []}])
        bad_goal = json.dumps([{"metric": "hips", "target": "70", "unit": "kg", "direction": "decrease"}])

        self.client.post(
            "/import/routines",
            data={"routines_file": (io.BytesIO(bad_routine.encode()), "routines.json")},
        )
        self.client.post(
            "/import/goals",
            data={"goals_file": (io.BytesIO(bad_goal.encode()), "goals.json")},
        )

        saved = storage.load_data()
        self.assertEqual(saved["routines"][0]["id"], "existing-routine")
        self.assertEqual(saved["goals"][0]["id"], "existing-goal")

    def test_ui_includes_quick_picks_rest_presets_and_pr_milestones(self):
        self.log_set()
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        for feature in (
            b'id="quick-exercises"',
            b'id="auto-start-rest"',
            b'id="set-type-rest-preset"',
            b'id="personal-record-history"',
            b"Repeat workout",
            b"Copy set to logger",
            b"Export routines JSON",
            b"Export goals JSON",
        ):
            self.assertIn(feature, response.data)

    def test_training_insights_group_weekly_volume_and_exclude_warmups(self):
        today = datetime.date(2026, 11, 3)
        workouts = [
            {"date": "2026-11-03", "muscle": "Chest", "weight": "100", "unit": "kg", "reps": "5"},
            {"date": "2026-11-03", "muscle": "Chest", "weight": "50", "unit": "kg", "reps": "5", "set_type": "warmup"},
            {"date": "2026-11-02", "muscle": "Chest", "weight": "50", "unit": "kg", "reps": "10", "set_type": "working"},
            {"date": "2026-10-28", "muscle": "Back", "weight": "80", "unit": "kg", "reps": "10"},
            {"date": "2026-11-04", "muscle": "Legs", "weight": "200", "unit": "kg", "reps": "10"},
        ]

        insights = _training_insights(workouts, today)

        self.assertEqual(insights["training_days"], 3)
        self.assertEqual(insights["streak"], 2)
        self.assertEqual(insights["weekly_volume"], [
            {"muscle": "Chest", "volume": 1000.0, "sets": 2},
            {"muscle": "Back", "volume": 800.0, "sets": 1},
        ])
        self.assertEqual(insights["days_since"], 0)

    def test_training_insights_flag_inactivity_and_high_volume(self):
        today = datetime.date(2026, 11, 3)
        inactive = _training_insights(
            [{"date": "2026-10-20", "muscle": "Legs", "weight": "50", "reps": "10"}],
            today,
        )
        self.assertIn("14 days", inactive["recovery_note"])

        workouts = []
        for day in ("2026-10-22", "2026-10-15", "2026-10-08"):
            workouts.append({
                "date": day,
                "muscle": "Chest",
                "weight": "100",
                "reps": "10",
                "set_type": "working",
            })
        workouts.append({
            "date": "2026-11-01",
            "muscle": "Chest",
            "weight": "160",
            "reps": "10",
            "set_type": "working",
        })
        high_volume = _training_insights(workouts, today)
        self.assertIn("Consider recovery or a deload", high_volume["recovery_note"])

    def test_navigation_and_charts_include_accessibility_alternatives(self):
        self.log_set()
        page = self.client.get("/?tab=progress")
        self.assertIn(b"Skip to content", page.data)
        self.assertIn(b'role="tablist"', page.data)
        self.assertIn(b'aria-selected="true"', page.data)
        self.assertIn(b"aria-describedby=\"progress-summary progress-chart-data\"", page.data)
        self.assertIn(b"progress-chart-data", page.data)
        self.assertIn(b"measurement-chart-data", page.data)
        self.assertIn(b"training insights", page.data.lower())

    def test_installable_app_assets_are_served(self):
        worker = self.client.get("/service-worker.js")
        manifest = self.client.get("/static/manifest.json")
        favicon = self.client.get("/static/icon.svg")
        page = self.client.get("/")
        self.assertEqual(worker.status_code, 200)
        self.assertIn(b"irontrack-shell", worker.data)
        self.assertEqual(manifest.status_code, 200)
        self.assertIn(b"standalone", manifest.data)
        self.assertEqual(favicon.status_code, 200)
        self.assertIn(b"<svg", favicon.data)
        self.assertIn(b'rel="icon" type="image/svg+xml" href="/static/icon.svg"', page.data)
        worker.close()
        manifest.close()
        favicon.close()
        page.close()

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
        self.assertIn(b"estimated-1rm", response.data)
        self.assertIn(b"Weekly muscle volume", response.data)
        self.assertIn(b'id="progress-more-details" class="progress-details"', response.data)
        self.assertIn(b"More progress insights", response.data)
        self.assertIn(b"id=\"progress-chart-content\"", response.data)
        self.assertIn(b'id="personal-records-section"', response.data)
        self.assertIn(b"initializeProgressDetails", response.data)
        self.assertIn(b"Controlled tempo", response.data)

    def test_library_has_search_and_category_filters_and_set_notes_input(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="library-search"', response.data)
        self.assertIn(b'id="library-category-filter"', response.data)
        self.assertIn(b'id="library-no-results"', response.data)
        self.assertIn(b'name="notes"', response.data)
        self.assertIn(b"Set notes", response.data)

    def test_workout_and_empty_state_ui_affordances_render(self):
        response = self.client.get("/?tab=history")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'class="set-options"', response.data)
        self.assertIn(b"Set details", response.data)
        self.assertIn(b'id="session-duration" class="session-status"', response.data)
        self.assertIn(b'id="timer-display" role="status" aria-live="polite"', response.data)
        self.assertIn(b"Your workout history starts here", response.data)
        self.assertIn(b'id="history-calendar" class="history-disclosure', response.data)
        self.assertIn(b"initializeHistoryLayout", response.data)
        self.assertIn(b'id="progress-empty-message"', response.data)
        self.assertIn(b"Log a workout", response.data)
        self.log_set()
        history_with_workout = self.client.get("/?tab=history&month=2026-10")
        self.assertIn(b'class="history-workout-actions border-t border-slate-800 pt-3" open', history_with_workout.data)
        self.assertIn(b"calendar-day-count", history_with_workout.data)

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
