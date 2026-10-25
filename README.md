# Chit Fund Manager

A full-stack web app for running chit fund schemes: enrolling members, issuing tickets, running monthly auctions, collecting monthly installments, and reconciling dues. It has an **admin console** for the organizer and a **member portal** for subscribers.

> Internal app name: **AuctionTicket Pro**

## Features

**Admin console**
- Dashboard with total collected, overdue, due this month, and monthly collection progress
- Click Overdue / Due This Month to jump to the filtered payments table
- Members, tickets, and payments management with search and filters
- In-app payment reminders that appear in the member's notification bell
- Reconcile offline (cash / bank) payments
- Export payments as CSV
- Launch new chit schemes

**Member portal**
- OTP-based login
- My tickets, monthly payment schedule, and paid ledger
- Auction pools with live rounds and bidding
- Notifications for due, overdue, paid, and admin reminders
- Pay installments by UPI (Razorpay QR)

**Backend**
- REST API with token authentication
- Daily automatic update of payment status (Due → Overdue)
- Razorpay QR creation and webhook handling
- Payment ledger that records every status change

## Tech stack

| Layer     | Technology                                  |
|-----------|---------------------------------------------|
| Frontend  | React 18, Vite 5, lucide-react              |
| Backend   | Django 4.2+, Django REST Framework          |
| Database  | MySQL                                       |
| Payments  | Razorpay (UPI QR + webhooks)                |

## Project structure

```
.
├── backend/                 # Django API
│   ├── api/                 # models, views, serializers, migrations, tests
│   │   └── management/commands/   # seed_data, generate_monthly_dues
│   ├── backend/             # Django settings and root URLs
│   ├── manage.py
│   ├── requirements.txt
│   ├── .env.example         # copy to .env
│   └── start_backend.bat    # Windows one-click start
└── frontend/                # React app
    ├── src/
    │   ├── views/           # AdminConsoleView, MyTicketsView, PoolsView, ...
    │   ├── components/
    │   ├── services/api.js  # API client
    │   └── utils/
    ├── vite.config.js       # proxies /api to the backend
    └── start_frontend.bat   # Windows one-click start
```

## Getting started

### Prerequisites
- Python 3.10+
- Node.js 18+
- MySQL 8 running locally

### 1. Database
Create an empty database:

```sql
CREATE DATABASE kd_chit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux
pip install -r requirements.txt

cp .env.example .env           # then edit .env with your values
python manage.py migrate
python manage.py seed_data     # optional: demo users, scheme, and payments
python manage.py runserver 127.0.0.1:8000
```

On Windows you can also double-click `backend/start_backend.bat`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

On Windows you can also double-click `frontend/start_frontend.bat`.

Open the URL Vite prints (usually http://localhost:5173). The dev server proxies `/api` to `http://127.0.0.1:8000`, so start the backend first.

## Configuration

Copy `backend/.env.example` to `backend/.env` and fill in:

| Variable                  | Purpose                                              |
|---------------------------|------------------------------------------------------|
| `SECRET_KEY`              | Django secret key (use a long random value)          |
| `DEBUG`                   | `True` for development, `False` in production        |
| `ALLOWED_HOSTS`           | Comma-separated hostnames                            |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` | MySQL connection |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay API keys (use test keys in development) |
| `RAZORPAY_WEBHOOK_SECRET` | Secret used to verify Razorpay webhooks              |

**Never commit `.env`.** It is already listed in `.gitignore`.

For a deployed frontend, set `VITE_API_URL` to your API's base URL. By default the app uses `/api`.

## Useful commands

```bash
# Run backend tests
python manage.py test api

# Generate monthly installments for active tickets
python manage.py generate_monthly_dues

# Production build of the frontend
npm run build
```

## Razorpay webhook

Point your Razorpay webhook to:

```
https://<your-domain>/api/payments/webhook/
```

Use the same secret you set in `RAZORPAY_WEBHOOK_SECRET`. Online UPI payments are marked paid automatically. Cash and bank payments are recorded by an admin using **Reconcile**.

## Security notes

- The `seed_data` command creates a demo admin account with a known password. **Change it, or do not run the command, in any real deployment.**
- Bank account details are currently stored as plain text. Consider encrypting them before going to production.
- Run with `DEBUG=False` and a restricted `ALLOWED_HOSTS` in production.

## License

Private / proprietary. All rights reserved.
