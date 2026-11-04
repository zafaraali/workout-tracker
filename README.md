# IronTrack Workout Logger

IronTrack is a self-hosted, FitNotes-style workout tracker built with Flask. It stores workout and fitness data in a local JSON file and runs in a web browser on desktop or mobile.

## Features

- **Workout logging:** Record exercises by date and session, including working, warm-up, drop, failure, and cardio sets. Strength sets support weight (kg or lb), reps, RPE, and notes; cardio sets support distance, units, and duration.
- **Workout sessions:** Name workouts, start and finish sessions, track duration, reorder exercises, and group exercises into supersets.
- **Workout history:** Browse workouts by date, use the monthly activity calendar, edit sets and workout names/dates, or delete an individual set or an entire workout.
- **Exercise library:** Search and filter exercises by category; add, rename, recategorize, or delete exercises; add and remove empty categories; restore the default library without deleting workout history.
- **Rest timer:** Start and stop a rest timer, see an active timer in the top bar, and hear an alarm when the timer ends. Only one timer can run at a time. Save rest presets by set type or exercise, and optionally start the timer after logging a set.
- **Personal records:** See best strength and cardio performances, including a dated milestone history for weight, reps, session volume, cardio distance, and duration.
- **Progression suggestions:** Get a suggested next weight and rep target based on logged sets, with optional rep and weight goals.
- **Progress charts:** View exercise trends for best weight, best reps, total volume, cardio distance, or cardio duration over the last 30 days, 90 days, or all time.
- **Training insights:** Review rolling 7-day strength volume by muscle group, training days, and consecutive-day streaks. Get gentle inactivity or unusually high-volume recovery reminders.
- **Routines:** Build and edit routines with warm-up and working set targets, reps, warm-up/starting weight, per-working-set weight increases, rest time, and notes. Start a session from a routine and check off planned sets as you go. Save a logged workout as a routine.
- **Body measurements and goals:** Record and edit body weight, waist, chest, and hip measurements with notes; view measurement trends and track goals with progress indicators.
- **Import and export:** Download a complete JSON backup or CSV exports for workouts and measurements. Export and import routines and goals independently, or restore a complete JSON backup. Separate routine/goal imports replace the existing list of that type.
- **Repeat and quick logging:** Repeat a saved workout on a chosen date, copy an individual set into the logger, and use recent/favorite exercise shortcuts.
- **Automatic recovery:** Create automatic pre-save snapshots (up to 10 are retained), restore a snapshot, and attempt recovery from a snapshot if the data file is missing or damaged.
- **Personalization and mobile support:** Responsive layout, date pickers, light/dark mode, and a customizable accent color.
- **Accessibility:** Keyboard-operable tab navigation, skip-to-content link, visible focus states, reduced-motion support, and text alternatives for chart data.
- **Installable and offline support:** The service worker caches the app shell for offline access. Workout submissions made offline are queued in the browser and synced when the connection returns. The app can be installed as a PWA in supported browsers.

## Technology

- **Python 3.11 or newer**
- **Flask** for the local web server and routes
- **Jinja** templates for rendering the interface
- **Vanilla JavaScript and CSS** for interactive features and responsive styling
- **Tailwind CSS** loaded from its CDN
- **JSON files** for server-side data storage and backups
- **Browser APIs** including local storage, session storage, service workers, and Web Audio
- **Python `unittest`** for automated tests

No database server or frontend build step is required. Tailwind is loaded from a CDN, so a network connection is needed to fetch it initially; the service worker attempts to cache it for later offline use.

## Run locally

### Windows (PowerShell)

From the project directory:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install Flask
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000).

If PowerShell prevents virtual environment activation, either allow activation for your user according to your organization's policy, or run the interpreter and pip directly:

```powershell
.\.venv\Scripts\python.exe -m pip install Flask
.\.venv\Scripts\python.exe app.py
```

### macOS or Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install Flask
python app.py
```

The development server runs on port `5000` with Flask debug mode enabled. Use a production WSGI server and disable debug mode before exposing the app beyond a trusted local environment. Set `FLASK_SECRET_KEY` to a persistent, private value when running beyond local development; otherwise the app generates a new key at startup.

## Data and backups

The app writes its data to `workout_data.json` in the project directory and keeps automatic snapshots in `workout_backups/`. These files contain your workout and personal measurement data. Keep them private and include them in your backup plan. Use **Export Backup** in workout history to download a portable JSON backup; use **Restore Backup** to import one.

Offline workout submissions are kept in the current browser's local storage until they can sync to the server. They are separate from the server's JSON data until synced, so reconnect and confirm synchronization before clearing browser data or switching devices.

## Run tests

The test suite uses Python's built-in `unittest`:

```powershell
python -m unittest discover -s tests -v
```

On macOS or Linux, use the same command after activating the virtual environment.

## Project layout

```text
app.py                    Flask application entry point
routes.py                 Page and feature routes
storage.py                JSON persistence and automatic recovery
data_types.py             Shared workout, routine, measurement, and goal types
exercise_library.py       Default library and exercise management helpers
templates/index.html      Main Jinja-rendered interface
static/app.js             Client-side interactions and offline queue
static/app.css            Responsive and theme styling
static/service-worker.js  App-shell caching and offline behavior
static/manifest.json      Installable web app metadata
tests/                    Automated tests
workout_data.json         Local data file (created as needed)
workout_backups/          Automatic data snapshots (created as needed)
```
