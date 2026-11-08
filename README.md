# IronTrack Workout Logger

IronTrack is a self-hosted, FitNotes-style workout tracker built with Flask. It stores workout and fitness data in a local SQLite database and runs in a web browser on desktop or mobile.

## Features

- **Workout logging:** Record exercises by date and session, including working, warm-up, drop, failure, and cardio sets. Strength sets support weight (kg or lb), reps, RPE, and notes; cardio sets support distance, units, and duration.
- **Bodyweight logging:** Bodyweight strength sets are explicit; zero external load is no longer accepted as an ambiguous weighted set.
- **Workout sessions:** Name workouts, start and finish sessions, track duration, reorder exercises, and group exercises into supersets.
- **Workout history:** Browse workouts by date, use the monthly activity calendar, edit sets and workout names/dates, or delete an individual set or an entire workout.
- **History tools:** Search by workout, exercise, category, or notes; filter by muscle group and set type; bulk-select visible sets; undo recent set deletions; and review compatible CSV files before importing.
- **Exercise library:** Search and filter exercises by category; add, rename, recategorize, or delete exercises; add and remove empty categories; restore the default library without deleting workout history.
- **Gym profiles and exercise metadata:** Name your gym, record available equipment, and see movement/equipment metadata alongside exercises when planning workouts.
- **Rest timer:** Start and stop a rest timer, see an active timer in the top bar, and hear an alarm when the timer ends. Only one timer can run at a time. Save rest presets by set type or exercise, and optionally start the timer after logging a set.
- **Personal records:** See best strength and cardio performances, including a dated milestone history for weight, reps, session volume, cardio distance, and duration.
- **Training progression:** Track sets reaching your rep target, flag plateaus across three completed sessions using estimated 1RM, and suggest a load increase only after all planned working sets meet the target at RPE 8 or below. Warm-ups and drop sets are excluded.
- **Progress charts:** View exercise trends for best weight, best reps, total volume, estimated 1RM (Epley estimate), cardio distance, or cardio duration over the last 30 days, 90 days, or all time. Compare eight weekly muscle-volume totals with accessible text summaries; warm-up and cardio sets are excluded and loads are normalized to kg.
- **Training balance:** Compare recent working volume across muscle groups and receive a gentle concentration/imbalance insight without replacing professional training or medical advice.
- **Training insights:** Review rolling 7-day strength volume by muscle group, training days, and consecutive-day streaks. Get gentle inactivity or unusually high-volume recovery reminders.
- **Routines:** Build and edit routines with warm-up and working set targets, reps, warm-up/starting weight, per-working-set weight increases, rest time, notes, and optional weekday schedules. Start a session from a routine and check off planned sets as you go. Compare the latest two matching sessions by completed/planned sets, average load and reps, and working volume. Save a logged workout as a routine.
- **Body measurements and goals:** Record and edit body weight, waist, chest, and hip measurements with notes; view measurement trends and track goals with progress indicators.
- **Import and export:** Download a complete JSON backup or CSV exports for workouts and measurements. Export and import routines and goals independently, or preview a complete JSON backup and explicitly merge or replace. Workout CSV imports recognize common Strong, Hevy, FitNotes, and IronTrack columns, aliases, UTF-8/UTF-16/CP1252 encodings, and comma/semicolon/tab delimiters. Merge keeps existing data and avoids duplicates for matching workout/routine/measurement/goal IDs where available.
- **Database backups:** Download a verified SQLite backup directly from workout history. SQLite data is stored in separate tables for workouts, routines, measurements, goals, and the exercise library.
- **Repeat and quick logging:** Repeat workouts, use recent/favorite shortcuts, bring up numeric mobile keyboards, and adjust weight or reps with large buttons. Swipe a history set sideways to reveal actions; deletion still requires confirmation.
- **Keyboard navigation:** Use `/` to jump to exercise search, `L` for logging, `H` for History, `P` for Progress, and `R` for Routines. Shortcuts are ignored while entering form data.
- **Automatic recovery:** Create automatic pre-save snapshots (up to 10 are retained), restore a snapshot, and attempt recovery from a snapshot if the data file is missing or damaged.
- **Diagnostics:** Open **Diagnostics** from the header to check database integrity, storage size, backup freshness, and record counts.
- **Personalization and mobile support:** Responsive layout, date pickers, light/dark mode, and a customizable accent color.
- **Accessibility:** Keyboard-operable tab navigation, URL-persistent sections, synchronized tab-panel visibility for assistive technology, skip-to-content link, visible focus states, reduced-motion support, and text alternatives for chart data.
- **Submission feedback:** Mutating forms prevent accidental duplicate submissions and expose saving/importing progress; recoverable errors use accessible toasts instead of blocking alerts.
- **Security:** Production debug mode is off by default, state-changing forms use CSRF tokens, session cookies are hardened, and common browser security headers are sent.
- **Installable and offline support:** The service worker caches the app shell for offline access. Workout submissions made offline are queued in the browser and synced when the connection returns. The app can be installed as a PWA in supported browsers.

- **Exercise substitutions:** Swap the current routine exercise for this workout while retaining its set, rep, and rest targets. Choose a new starting weight; load and increment values reset for the replacement. Logged sets retain the original routine slot, so completion counts combine the planned exercise and its replacements. Saved routines stay unchanged.
- **Weekly review:** View completed and unfinished sessions, volume versus the previous full calendar week, new weight records, and scheduled-workout adherence due so far. Find it in **Progress**.
- **Single-owner sign-in:** Protect pages, exports, and writes with a password when running the production server. Login uses a password hash, CSRF protection, and a five-attempt/15-minute limit per connection IP.

## Technology

- **Python 3.11 or newer**
- **Flask** for the local web server and routes
- **Jinja** templates for rendering the interface
- **Vanilla JavaScript and CSS** for interactive features and responsive styling
- **Tailwind CSS** compiled into a local stylesheet
- **SQLite** for server-side persistence, with the original JSON file retained as a portable mirror and migration fallback
- **Browser APIs** including local storage, session storage, service workers, and Web Audio
- **Python `unittest`** for automated tests
- **GitHub Actions** for repeatable Python, JavaScript, CSS-build, and browser checks on pushes and pull requests

No database server or frontend build step is required to run the app. The compiled Tailwind stylesheet is included locally, including for offline use. After changing templates or JavaScript classes, rebuild it with `npm ci` and `npm run build:css`.

## Run locally

### Windows (PowerShell)

From the project directory:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000).

If PowerShell prevents virtual environment activation, either allow activation for your user according to your organization's policy, or run the interpreter and pip directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

### macOS or Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

The development server runs on port `5000` with debug mode disabled by default. Set `FLASK_DEBUG=1` only for local development. Use a production WSGI server and disable debug mode before exposing the app beyond a trusted local environment. Set `FLASK_SECRET_KEY` to a persistent, private value when running beyond local development; otherwise the app generates a new key at startup.

## Private hosting and access

Install dependencies and create your own username, password hash, and persistent session key:

```powershell
python -m pip install -r requirements.txt
python configure_access.py
python serve.py
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). The setup command prompts for a password without echoing it. It writes private `access.json` (used by `serve.py`) and `.env` (used by Docker Compose); both are ignored by Git. It refuses to overwrite existing credentials. To rotate credentials, move those files to a private backup location, rerun setup, and restart the server. Changing the password hash invalidates existing sign-ins.

`serve.py` uses [Waitress, a production WSGI server supported on Windows](https://flask.palletsprojects.com/en/stable/deploying/waitress/). It refuses to start without a password hash and a persistent session key of at least 32 characters. The development command `python app.py` keeps the existing local, unsigned-in experience unless authentication environment variables are set. Use `serve.py` for hosting.

Docker Compose uses the same generated `.env`:

```powershell
docker compose up --build -d
```

The container runs as a non-root user, binds the published port to localhost, and stores its data in the persistent `irontrack-data` volume. It starts with an empty database; use the backup import preview after signing in to migrate your existing data. Rebuilding the image preserves the named volume. Export a backup before maintenance; `docker compose down --volumes` removes the stored data.

For access from another device, put an HTTPS reverse proxy or private HTTPS tunnel in front of port 8080, and set `FLASK_COOKIE_SECURE=1` for that HTTPS deployment. The Compose port stays on localhost so traffic goes through the proxy. Configure access controls on your proxy/tunnel as appropriate. This repository prepares the server and container; it does not provision a domain, certificates, or a public hosting account.

Configuration environment variables override `access.json`:

| Variable | Purpose |
| --- | --- |
| `FLASK_SECRET_KEY` | Persistent private session-signing key, at least 32 characters |
| `IRONTRACK_PASSWORD_HASH` | [Werkzeug password hash](https://werkzeug.palletsprojects.com/en/stable/utils/#werkzeug.security.generate_password_hash), generated by setup |
| `IRONTRACK_USERNAME` | Single owner username; defaults to `owner` |
| `IRONTRACK_DATA_DIR` | Directory for SQLite, JSON mirror, and automatic snapshots |
| `IRONTRACK_HOST` | Listener address; defaults to `127.0.0.1` |
| `PORT` | Production port; defaults to `8080` |
| `FLASK_COOKIE_SECURE` | Set to `1` when accessed over HTTPS |

The rate limit is held in memory for the single Waitress process; restarting resets it. Sign-in expires after 12 hours of inactivity. Workout pages remain cached on the signed-in device for offline use. Sign-out is blocked while unsynced sets remain, then clears IronTrack's local preferences, drafts, cached pages, and service worker. Use sign-out before sharing the device. An expired login preserves queued sets and offers a sign-in link before syncing.

## Data and backups

The authoritative data is `irontrack.sqlite3` in the project directory. The app also writes a portable JSON mirror to `workout_data.json` and keeps automatic pre-save snapshots in `workout_backups/`. Existing JSON data is migrated only when the database is absent; editing or damaging the mirror never replaces a healthy database. Use the import preview to apply JSON changes deliberately. A corrupt database is preserved as `irontrack.corrupt.<id>.sqlite3` before snapshot recovery. These files contain your workout and personal measurement data. Keep them private and include them in your backup plan. Use **Export Backup** in workout history to download a portable JSON backup; use **Restore Backup** to import one.

Offline workout submissions are kept in the current browser's local storage until they can sync to the server. Open **Review pending sets** to inspect errors, edit a rejected set, and retry. Sync refreshes its security token and continues past invalid entries. They are separate from the server's database until synced, so reconnect and confirm synchronization before clearing browser data or switching devices.

## Run tests

The test suite uses Python's built-in `unittest`:

```powershell
python -m unittest discover -s tests -v
```

On macOS or Linux, use the same command after activating the virtual environment.

## Browser checks and frontend development

Install the optional development dependencies and browser:

```powershell
npm ci
npx playwright install chromium
npm run build:css
npm run test:browser
node --test tests/js/training.test.cjs
```

Browser tests start disposable development and production (Waitress) servers on ports 5001 and 5002 with temporary data and test-only credentials. They never use your personal database. Set `PYTHON` to your Python executable if `python` is unavailable. To use an installed Chrome or Edge instead of downloading Chromium, set `PLAYWRIGHT_CHANNEL` to `chrome` or `msedge`.

Tests cover reconnecting with a new CSRF session, exactly-once offline replay, editing invalid queued sets, mobile logging, repeating a set, workout focus, and deletion undo. Server tests also cover concurrent writes, rollback, stable row identity, and recovery.

## Project layout

```text
app.py                    App setup, CSRF protection, request transactions
auth.py                   Single-owner login and throttling
serve.py                  Production Waitress entry point
configure_access.py       Interactive private credential setup
Dockerfile, compose.yaml  Repeatable container setup
training_review.py        Calendar-week review and routine adherence
routing.py                Shared feature blueprint
routes.py                 Workout sessions and exercise-library routes
routine_routes.py         Routine management and validation
measurement_routes.py     Measurements and goals
backup_routes.py          Backup, import, and export routes
workout_domain.py         Workout validation and training analytics
storage.py                SQLite transactions, JSON mirror, and recovery
data_types.py             Shared data types
exercise_library.py       Default exercise library and helpers

templates/index.html      Shared page shell
templates/sections/       Feature templates
static/app.js             Logger, timers, and shared interactions
static/offline.js         Offline queue, repair UI, and sync
static/progress.js        Progress charts and personal records
static/routines.js        Routine builder, swaps, and active-set targets
static/training.js        Progression, quick logging, and swipe controls
static/app.css            Responsive and theme styling
static/tailwind.css       Included compiled utility stylesheet
static/service-worker.js  Offline app-shell caching
styles/tailwind.css        Tailwind source

tests/                    Server and mobile browser tests
irontrack.sqlite3         Primary database (created automatically)
workout_data.json         Portable JSON mirror and initial migration source
workout_backups/          Automatic data snapshots
```

The logger shows your last performance beside the weight and rep fields. Use **Repeat last set** to fill them in, or **Toggle workout focus** to keep the logger and active workout prominent. Routine targets and set checklists remain visible in the active workout. After deleting a set, **Undo deletion** restores the most recently deleted set, including its original position.
