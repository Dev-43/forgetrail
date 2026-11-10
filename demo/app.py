from flask import Flask

app = Flask(__name__)

# Sensitive configuration keys (should be masked as *** by flask config)
app.config["SECRET_KEY"] = "super-secret-key-12345"
app.config["DB_PASSWORD"] = "my_hidden_db_password"
app.config["API_TOKEN"] = "token_xyz987654321"
app.config["STRIPE_KEY"] = "sk_test_fake_stripe_key"

# Normal configuration keys (should remain visible)
app.config["APP_NAME"] = "ForgeTrail Demo App"
app.config["REGION"] = "us-east-1"


@app.route("/")
def index():
    return "ForgeTrail Demo App Running"


if __name__ == "__main__":
    app.run()
