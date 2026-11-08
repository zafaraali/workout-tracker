"""Optional single-owner sign-in for a self-hosted personal tracker."""
import hashlib
import hmac
import time
from threading import Lock
from flask import current_app, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

_attempts = {}
_attempt_lock = Lock()


def auth_enabled():
    return bool(current_app.config.get("IRONTRACK_PASSWORD_HASH"))


def _identity():
    value = current_app.config.get("IRONTRACK_PASSWORD_HASH", "") + current_app.config.get("IRONTRACK_USERNAME", "owner")
    return hashlib.sha256(value.encode()).hexdigest()


def authenticated():
    return session.get("owner") == _identity()


def require_owner():
    if not auth_enabled() or request.endpoint in {"login", "logout", "health", "static", "main.service_worker"}:
        return
    if authenticated():
        return
    if request.method != "GET" or request.endpoint == "refresh_csrf_token":
        return jsonify(ok=False, error="Sign in to save or sync your sets.", login_url=url_for("login")), 401
    return redirect(url_for("login"))


def register_auth(app, csrf_token):
    # This guard must run before CSRF processing and before opening a database transaction.
    app.before_request(require_owner)

    @app.context_processor
    def auth_context():
        return {"auth_enabled": auth_enabled()}

    @app.get("/healthz")
    def health():
        return {"ok": True}

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if not auth_enabled() or authenticated():
            return redirect(url_for("main.index"))
        error = ""
        status = 200
        if request.method == "POST":
            now = time.monotonic()
            remote = request.remote_addr or "unknown"
            with _attempt_lock:
                for key in list(_attempts):
                    if _attempts[key][1] <= now:
                        del _attempts[key]
                count, expiry = _attempts.get(remote, (0, now + 900))
                blocked = count >= 5 or (remote not in _attempts and len(_attempts) >= 1024)
                if not blocked:
                    _attempts[remote] = (count + 1, expiry)
            if blocked:
                error, status = "Too many attempts. Try again in 15 minutes.", 429
            else:
                valid_password = check_password_hash(app.config["IRONTRACK_PASSWORD_HASH"], request.form.get("password", ""))
                valid_user = hmac.compare_digest(request.form.get("username", "").encode(), app.config["IRONTRACK_USERNAME"].encode())
                if valid_password and valid_user:
                    with _attempt_lock:
                        _attempts.pop(remote, None)
                    session.clear()
                    csrf_token()
                    session["owner"] = _identity()
                    session.permanent = True
                    return redirect(url_for("main.index"))
                error, status = "Username or password is incorrect.", 401
        return render_template("login.html", error=error), status

    @app.post("/logout")
    def logout():
        session.clear()
        response = app.make_response(render_template("signed_out.html"))
        response.headers["Clear-Site-Data"] = '"cache", "storage"'
        return response
