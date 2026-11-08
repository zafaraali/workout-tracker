"""Create local single-owner credentials without putting a password in shell history."""
import getpass
import json
from pathlib import Path
import secrets

from werkzeug.security import generate_password_hash


def main():
    target = Path(__file__).with_name("access.json")
    if target.exists() or target.with_name(".env").exists():
        raise SystemExit("access.json or .env already exists. Move your existing configuration before creating new credentials.")
    username = input("Username [owner]: ").strip() or "owner"
    password = getpass.getpass("Password (at least 12 characters): ")
    if len(password) < 12 or len(password) > 1024 or password != getpass.getpass("Repeat password: "):
        raise SystemExit("Passwords must match and contain 12–1024 characters.")
    if len(username) > 100 or any(character in username for character in "\r\n'="):
        raise SystemExit("Use a username of at most 100 characters without quotes, line breaks, or equals signs.")
    settings = {
        "FLASK_SECRET_KEY": secrets.token_hex(32),
        "IRONTRACK_USERNAME": username,
        "IRONTRACK_PASSWORD_HASH": generate_password_hash(password),
    }
    target.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    target.with_name(".env").write_text("\n".join(f"{key}='{value}'" for key, value in settings.items()) + "\n", encoding="utf-8")
    print("Created access.json for the local server and .env for Docker Compose. Keep both files private.")


if __name__ == "__main__":
    main()
