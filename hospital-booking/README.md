# MediFlow — Hospital Appointment Booking System

A complete, working hospital appointment booking system: Flask (Python) backend,
SQLite database, and a single-page HTML/CSS/JavaScript frontend built around a
guided, step-by-step booking flow.

## Features

- **Patient accounts** — register / log in / log out (passwords hashed with Werkzeug)
- **Browse doctors** by department, with search-friendly filtering
- **4-step booking wizard** — department → doctor → date & time → details → confirmation,
  with a live progress stepper
- **Real-time slot availability** — computed from each doctor's weekly schedule minus
  already-booked appointments, so double-booking is impossible
- **My appointments** — view upcoming/past visits, cancel with one click
- **Admin dashboard** — stats, full appointment log, and a form to add new doctors
  (log in with `admin@hospital.com` / `admin123`)

## Project structure

```
hospital-booking/
├── app.py                 # Flask app + JSON API
├── database.py             # SQLite schema, connection helper, seed data
├── requirements.txt
├── templates/
│   └── index.html          # Single-page app shell (all views)
└── static/
    ├── css/style.css        # Design system + components
    └── js/app.js             # Frontend logic (routing, wizard, API calls)
```

## Setup

```bash
cd hospital-booking
pip install -r requirements.txt
python3 database.py       # creates hospital.db and seeds departments/doctors/admin
python3 app.py             # starts the dev server on http://127.0.0.1:5000
```

Then open **http://127.0.0.1:5000** in your browser.

If you skip the `python3 database.py` step, `app.py` will create and seed the
database automatically on first run.

## Demo accounts

- **Admin:** `admin@hospital.com` / `admin123`
- **Patient:** sign up for a free account from the "Sign up" button — any email/password works.

## Data model (SQLite)

- `users` — patients and the admin account (`role` column distinguishes them)
- `departments` — 8 seeded departments (Cardiology, Neurology, Orthopedics, etc.)
- `doctors` — 10 seeded doctors linked to departments
- `doctor_schedule` — weekly recurring availability windows per doctor
- `appointments` — bookings, linked to a user and a doctor, with `status`
  (`confirmed` / `cancelled` / `completed`)

## API overview

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Create a patient account |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Current session user |
| GET | `/api/departments` | List departments with doctor counts |
| GET | `/api/doctors?department_id=` | List doctors, optionally filtered |
| GET | `/api/doctors/<id>` | Single doctor detail |
| GET | `/api/slots?doctor_id=&date=` | Free time slots for a doctor on a date |
| POST | `/api/appointments` | Book an appointment (login required) |
| GET | `/api/appointments/mine` | The logged-in patient's appointments |
| POST | `/api/appointments/<id>/cancel` | Cancel an appointment |
| GET | `/api/admin/stats` | Dashboard stats (admin only) |
| GET | `/api/admin/appointments` | All appointments (admin only) |
| GET/POST | `/api/admin/doctors` | List / add doctors (admin only) |

## Notes for production use

This ships with Flask's built-in dev server and a plaintext `SECRET_KEY`
default — fine for local use or a demo, but before deploying:

- Set a real `SECRET_KEY` environment variable
- Run behind a production WSGI server (gunicorn/uwsgi) + reverse proxy
- Consider moving from SQLite to Postgres/MySQL if you expect concurrent write load
- Add email/SMS confirmations and a password-reset flow
