import os
import secrets

from flask import Flask

from routes import main


app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.register_blueprint(main)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
