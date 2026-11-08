import os
import secrets
import hmac
from datetime import timedelta
from auth import auth_enabled, register_auth

from flask import Flask, abort, request, session, g, jsonify
from storage import write_transaction

from routes import main


app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("FLASK_COOKIE_SECURE") == "1",
    IRONTRACK_PASSWORD_HASH=os.environ.get("IRONTRACK_PASSWORD_HASH", ""),
    IRONTRACK_USERNAME=os.environ.get("IRONTRACK_USERNAME", "owner"),
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    MAX_CONTENT_LENGTH=16 * 1024 * 1024,
)


def _csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


@app.context_processor
def inject_security_context():
    return {"csrf_token": _csrf_token()}


register_auth(app, _csrf_token)


@app.before_request
def protect_state_changes():
    if request.method != "POST" or app.config.get("TESTING"):
        return
    expected = session.get("csrf_token")
    provided = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        abort(400, description="The form security token is missing or invalid.")


@app.get("/csrf-token")
def refresh_csrf_token():
    response = jsonify(csrf_token=_csrf_token())
    response.headers["Cache-Control"] = "no-store"
    return response


@app.before_request
def begin_write():
    if request.method == "POST" and request.endpoint not in {"login", "logout"}:
        g.storage_write = write_transaction()
        g.storage_write.__enter__()


@app.after_request
def finish_write(response):
    transaction = g.pop("storage_write", None)
    if transaction:
        if response.status_code < 400:
            transaction.__exit__(None, None, None)
        else:
            error = RuntimeError("Request failed")
            transaction.__exit__(RuntimeError, error, None)
    return response


@app.teardown_request
def rollback_unfinished_write(error):
    transaction = g.pop("storage_write", None)
    if transaction:
        failure = error or RuntimeError("Request interrupted")
        transaction.__exit__(type(failure), failure, failure.__traceback__)


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if auth_enabled() and request.endpoint != "static":
        response.headers["Cache-Control"] = "private, no-store"
    if request.endpoint == "main.index" and response.status_code == 200:
        response.headers["X-IronTrack-Shell"] = "1"
    return response


app.register_blueprint(main)


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1", port=5000)
