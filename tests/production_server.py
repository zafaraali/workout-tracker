"""Run the production entry point with disposable credentials and data."""
import os
from pathlib import Path
import secrets
import sys
import tempfile

from werkzeug.security import generate_password_hash

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as directory:
        os.environ.update(
            IRONTRACK_DATA_DIR=directory,
            IRONTRACK_HOST="127.0.0.1",
            PORT="5002",
            FLASK_SECRET_KEY=secrets.token_hex(32),
            IRONTRACK_USERNAME="owner",
            IRONTRACK_PASSWORD_HASH=generate_password_hash("browser-only-password", method="scrypt:1024:8:1"),
            FLASK_COOKIE_SECURE="0",
        )
        from serve import main
        main()
