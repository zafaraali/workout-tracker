"""Serve isolated disposable data for browser tests; never open personal data."""
import sys
import logging
import os
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import storage
from app import app
from werkzeug.security import generate_password_hash

if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    with tempfile.TemporaryDirectory() as directory:
        storage.DATA_FILE = Path(directory) / "workout_data.json"
        if os.environ.get("IRONTRACK_TEST_AUTH") == "1":
            app.config.update(IRONTRACK_PASSWORD_HASH=generate_password_hash("browser-only-password", method="scrypt:1024:8:1"), IRONTRACK_USERNAME="owner")
        app.run(port=int(os.environ.get("IRONTRACK_TEST_PORT", "5001")), use_reloader=False, threaded=True)
