```python
"""
Django settings for AuctionTicket Pro backend project.
"""

from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent


# ============================================================
# LOAD ENVIRONMENT VARIABLES
# ============================================================

try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass


# ============================================================
# SECURITY
# ============================================================

SECRET_KEY = os.getenv("SECRET_KEY", "")

if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Set SECRET_KEY in your environment."
    )


DEBUG = os.getenv("DEBUG", "False").lower() in (
    "true",
    "1",
    "t",
)


# ============================================================
# ALLOWED HOSTS
# ============================================================

_raw_hosts = os.getenv(
    "ALLOWED_HOSTS",
    "localhost,127.0.0.1",
)

ALLOWED_HOSTS = [
    host.strip()
    for host in _raw_hosts.split(",")
    if host.strip()
]


# ============================================================
# APPLICATIONS
# ============================================================

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Third-party packages
    "corsheaders",
    "rest_framework",
    "rest_framework.authtoken",

    # Local apps
    "api.apps.ApiConfig",
]


# ============================================================
# MIDDLEWARE
# ============================================================

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


# ============================================================
# URL / WSGI
# ============================================================

ROOT_URLCONF = "backend.urls"

WSGI_APPLICATION = "backend.wsgi.application"


# ============================================================
# TEMPLATES
# ============================================================

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


# ============================================================
# DATABASE
# ============================================================

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.mysql",

        "NAME": os.getenv(
            "DB_NAME",
            "kd_chit",
        ),

        "USER": os.getenv(
            "DB_USER",
            "root",
        ),

        "PASSWORD": os.getenv(
            "DB_PASSWORD",
            "",
        ),

        "HOST": os.getenv(
            "DB_HOST",
            "127.0.0.1",
        ),

        "PORT": os.getenv(
            "DB_PORT",
            "3306",
        ),

        "OPTIONS": {
            "charset": "utf8mb4",
            "init_command": "SET sql_mode='STRICT_TRANS_TABLES'",
        },
    }
}


# ============================================================
# PASSWORD VALIDATION
# ============================================================

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME":
        "django.contrib.auth.password_validation."
        "UserAttributeSimilarityValidator",
    },
    {
        "NAME":
        "django.contrib.auth.password_validation."
        "MinimumLengthValidator",

        "OPTIONS": {
            "min_length": 6,
        },
    },
]


# ============================================================
# INTERNATIONALIZATION
# ============================================================

LANGUAGE_CODE = "en-us"

TIME_ZONE = "Asia/Kolkata"

USE_I18N = True

USE_TZ = True


# ============================================================
# STATIC FILES
# ============================================================

STATIC_URL = "static/"

STATIC_ROOT = BASE_DIR / "staticfiles"


# ============================================================
# DEFAULT PRIMARY KEY
# ============================================================

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# ============================================================
# SECURITY SETTINGS
# ============================================================

SESSION_COOKIE_HTTPONLY = True

CSRF_COOKIE_HTTPONLY = False

X_FRAME_OPTIONS = "DENY"

SECURE_CONTENT_TYPE_NOSNIFF = True


# ============================================================
# CORS CONFIGURATION
# ============================================================

CORS_ALLOW_CREDENTIALS = True


# Read allowed frontend origins from environment.
#
# Production Render:
#
# CORS_ALLOWED_ORIGINS=https://kd-chit.vercel.app
#
# Local development:
#
# CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

_raw_cors_origins = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "",
)

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in _raw_cors_origins.split(",")
    if origin.strip()
]


# ============================================================
# CSRF TRUSTED ORIGINS
# ============================================================

_raw_csrf_origins = os.getenv(
    "CSRF_TRUSTED_ORIGINS",
    "",
)

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in _raw_csrf_origins.split(",")
    if origin.strip()
]


# Never allow all origins in production.
CORS_ALLOW_ALL_ORIGINS = False


# ============================================================
# DJANGO REST FRAMEWORK
# ============================================================

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],

    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],

    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ],

    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
}


# ============================================================
# RAZORPAY CONFIGURATION
# ============================================================

# IMPORTANT:
# Do NOT put Razorpay credentials directly in this file.
# Configure them in Render Environment Variables.

RAZORPAY_KEY_ID = os.getenv(
    "RAZORPAY_KEY_ID",
    "",
)

RAZORPAY_KEY_SECRET = os.getenv(
    "RAZORPAY_KEY_SECRET",
    "",
)

RAZORPAY_WEBHOOK_SECRET = os.getenv(
    "RAZORPAY_WEBHOOK_SECRET",
    "",
)
```
