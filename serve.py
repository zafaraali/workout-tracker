"""Production entry point. Credentials are required before opening a listener."""
import json
import os
from pathlib import Path


def configure():
    config_file = Path(__file__).with_name("access.json")
    if config_file.exists():
        settings = json.loads(config_file.read_text(encoding="utf-8"))
        for key in ("FLASK_SECRET_KEY", "IRONTRACK_USERNAME", "IRONTRACK_PASSWORD_HASH"):
            if key in settings:
                os.environ.setdefault(key, settings[key])
    if len(os.environ.get("FLASK_SECRET_KEY", "")) < 32:
        raise RuntimeError("Set a persistent FLASK_SECRET_KEY of at least 32 characters or run configure_access.py.")
    password_hash = os.environ.get("IRONTRACK_PASSWORD_HASH", "")
    if not password_hash.startswith(("scrypt:", "pbkdf2:")) or len(password_hash.split("$")) != 3:
        raise RuntimeError("Configure a Werkzeug password hash or run configure_access.py before starting the server.")
    from werkzeug.security import check_password_hash
    try:
        check_password_hash(password_hash, "")
    except (ValueError, TypeError) as error:
        raise RuntimeError("The configured password hash is invalid. Run configure_access.py.") from error
    if not os.environ.get("IRONTRACK_USERNAME", "owner").strip():
        raise RuntimeError("IRONTRACK_USERNAME must not be blank.")


def main():
    configure()
    from app import app
    from waitress import serve
    serve(app, host=os.environ.get("IRONTRACK_HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8080")), threads=4)


if __name__ == "__main__":
    main()
