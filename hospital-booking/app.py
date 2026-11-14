"""
MediFlow — Hospital Appointment Booking System
Flask backend (SQLite) serving a JSON API + the static frontend.
"""
import os
from datetime import datetime, timedelta, date as date_cls, time as time_cls
from functools import wraps

from flask import Flask, jsonify, request, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

from database import get_db, init_db, DB_PATH

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me-mediflow")
app.config.update(SESSION_COOKIE_SAMESITE="Lax")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(r) for r in rows]


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify(error="Please log in to continue."), 401
        return f(*args, **kwargs)
    return wrapper


def admin_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if session.get("role") != "admin":
            return jsonify(error="Admin access required."), 403
        return f(*args, **kwargs)
    return wrapper


def current_user_row(conn):
    uid = session.get("user_id")
    if not uid:
        return None
    return conn.execute("SELECT id, name, email, phone, role FROM users WHERE id=?", (uid,)).fetchone()


def generate_day_slots(schedule_rows, booked_times, target_date_str):
    """Given schedule rows for one weekday + already-booked times, return free HH:MM slots."""
    slots = []
    today = date_cls.today()
    target = datetime.strptime(target_date_str, "%Y-%m-%d").date()
    now_time = datetime.now().time()

    for row in schedule_rows:
        start = datetime.strptime(row["start_time"], "%H:%M")
        end = datetime.strptime(row["end_time"], "%H:%M")
        step = timedelta(minutes=row["slot_minutes"])
        cur = start
        while cur < end:
            t_str = cur.strftime("%H:%M")
            if t_str not in booked_times:
                # skip past times if booking for today
                if target == today and cur.time() <= now_time:
                    cur += step
                    continue
                slots.append(t_str)
            cur += step
    return sorted(set(slots))


# --------------------------------------------------------------------------- #
# Static frontend
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return send_from_directory(app.template_folder, "index.html")


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
@app.post("/api/auth/register")
def register():
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    phone = (data.get("phone") or "").strip()
    password = data.get("password") or ""

    if not name or not email or not password:
        return jsonify(error="Name, email and password are required."), 400
    if len(password) < 6:
        return jsonify(error="Password must be at least 6 characters."), 400

    conn = get_db()
    try:
        exists = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if exists:
            return jsonify(error="An account with this email already exists."), 409

        cur = conn.execute(
            """INSERT INTO users (name, email, phone, password_hash, role, created_at)
               VALUES (?, ?, ?, ?, 'patient', ?)""",
            (name, email, phone, generate_password_hash(password), datetime.utcnow().isoformat()),
        )
        conn.commit()
        session["user_id"] = cur.lastrowid
        session["role"] = "patient"
        user = conn.execute("SELECT id, name, email, phone, role FROM users WHERE id=?",
                             (cur.lastrowid,)).fetchone()
        return jsonify(user=row_to_dict(user)), 201
    finally:
        conn.close()


@app.post("/api/auth/login")
def login():
    data = request.get_json(force=True, silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    conn = get_db()
    try:
        user = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify(error="Invalid email or password."), 401
        session["user_id"] = user["id"]
        session["role"] = user["role"]
        return jsonify(user={
            "id": user["id"], "name": user["name"], "email": user["email"],
            "phone": user["phone"], "role": user["role"]
        })
    finally:
        conn.close()


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/auth/me")
def me():
    conn = get_db()
    try:
        user = current_user_row(conn)
        if not user:
            return jsonify(user=None)
        return jsonify(user=row_to_dict(user))
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Departments & Doctors
# --------------------------------------------------------------------------- #
@app.get("/api/departments")
def departments():
    conn = get_db()
    try:
        deps = conn.execute("""
            SELECT d.*, COUNT(doc.id) as doctor_count
            FROM departments d
            LEFT JOIN doctors doc ON doc.department_id = d.id AND doc.active = 1
            GROUP BY d.id ORDER BY d.name
        """).fetchall()
        return jsonify(departments=rows_to_list(deps))
    finally:
        conn.close()


@app.get("/api/doctors")
def doctors():
    dept_id = request.args.get("department_id")
    search = request.args.get("q", "").strip()
    conn = get_db()
    try:
        query = """
            SELECT doc.*, d.name as department_name
            FROM doctors doc JOIN departments d ON d.id = doc.department_id
            WHERE doc.active = 1
        """
        params = []
        if dept_id:
            query += " AND doc.department_id = ?"
            params.append(dept_id)
        if search:
            query += " AND (doc.name LIKE ? OR d.name LIKE ?)"
            params += [f"%{search}%", f"%{search}%"]
        query += " ORDER BY doc.name"
        docs = conn.execute(query, params).fetchall()
        return jsonify(doctors=rows_to_list(docs))
    finally:
        conn.close()


@app.get("/api/doctors/<int:doctor_id>")
def doctor_detail(doctor_id):
    conn = get_db()
    try:
        doc = conn.execute("""
            SELECT doc.*, d.name as department_name
            FROM doctors doc JOIN departments d ON d.id = doc.department_id
            WHERE doc.id = ?
        """, (doctor_id,)).fetchone()
        if not doc:
            return jsonify(error="Doctor not found."), 404
        return jsonify(doctor=row_to_dict(doc))
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Availability
# --------------------------------------------------------------------------- #
@app.get("/api/slots")
def slots():
    doctor_id = request.args.get("doctor_id", type=int)
    date_str = request.args.get("date", "")
    if not doctor_id or not date_str:
        return jsonify(error="doctor_id and date are required."), 400
    try:
        target = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify(error="date must be in YYYY-MM-DD format."), 400

    if target < date_cls.today():
        return jsonify(slots=[])

    weekday = target.weekday()
    conn = get_db()
    try:
        sched = conn.execute(
            "SELECT * FROM doctor_schedule WHERE doctor_id=? AND weekday=?",
            (doctor_id, weekday),
        ).fetchall()
        if not sched:
            return jsonify(slots=[])

        booked = conn.execute(
            """SELECT appt_time FROM appointments
               WHERE doctor_id=? AND appt_date=? AND status='confirmed'""",
            (doctor_id, date_str),
        ).fetchall()
        booked_times = {b["appt_time"] for b in booked}

        free = generate_day_slots(sched, booked_times, date_str)
        return jsonify(slots=free)
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Appointments
# --------------------------------------------------------------------------- #
@app.post("/api/appointments")
@login_required
def create_appointment():
    data = request.get_json(force=True, silent=True) or {}
    doctor_id = data.get("doctor_id")
    appt_date = data.get("date")
    appt_time = data.get("time")
    reason = (data.get("reason") or "").strip()

    if not all([doctor_id, appt_date, appt_time]):
        return jsonify(error="doctor_id, date and time are required."), 400

    try:
        target = datetime.strptime(appt_date, "%Y-%m-%d").date()
    except ValueError:
        return jsonify(error="Invalid date."), 400
    if target < date_cls.today():
        return jsonify(error="Cannot book a date in the past."), 400

    conn = get_db()
    try:
        doc = conn.execute("SELECT * FROM doctors WHERE id=? AND active=1", (doctor_id,)).fetchone()
        if not doc:
            return jsonify(error="Doctor not found."), 404

        weekday = target.weekday()
        sched = conn.execute(
            "SELECT * FROM doctor_schedule WHERE doctor_id=? AND weekday=?",
            (doctor_id, weekday),
        ).fetchall()
        valid_times = set(generate_day_slots(
            sched,
            {b["appt_time"] for b in conn.execute(
                "SELECT appt_time FROM appointments WHERE doctor_id=? AND appt_date=? AND status='confirmed'",
                (doctor_id, appt_date)).fetchall()},
            appt_date
        ))
        if appt_time not in valid_times:
            return jsonify(error="That slot is no longer available. Please pick another."), 409

        cur = conn.execute(
            """INSERT INTO appointments (user_id, doctor_id, appt_date, appt_time, reason, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'confirmed', ?)""",
            (session["user_id"], doctor_id, appt_date, appt_time, reason, datetime.utcnow().isoformat()),
        )
        conn.commit()

        appt = conn.execute("""
            SELECT a.*, doc.name as doctor_name, doc.fee, d.name as department_name
            FROM appointments a
            JOIN doctors doc ON doc.id = a.doctor_id
            JOIN departments d ON d.id = doc.department_id
            WHERE a.id = ?
        """, (cur.lastrowid,)).fetchone()
        return jsonify(appointment=row_to_dict(appt)), 201
    finally:
        conn.close()


@app.get("/api/appointments/mine")
@login_required
def my_appointments():
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT a.*, doc.name as doctor_name, doc.fee, doc.avatar_color, d.name as department_name
            FROM appointments a
            JOIN doctors doc ON doc.id = a.doctor_id
            JOIN departments d ON d.id = doc.department_id
            WHERE a.user_id = ?
            ORDER BY a.appt_date DESC, a.appt_time DESC
        """, (session["user_id"],)).fetchall()
        return jsonify(appointments=rows_to_list(rows))
    finally:
        conn.close()


@app.post("/api/appointments/<int:appt_id>/cancel")
@login_required
def cancel_appointment(appt_id):
    conn = get_db()
    try:
        appt = conn.execute("SELECT * FROM appointments WHERE id=?", (appt_id,)).fetchone()
        if not appt:
            return jsonify(error="Appointment not found."), 404
        if appt["user_id"] != session["user_id"] and session.get("role") != "admin":
            return jsonify(error="You can only cancel your own appointments."), 403
        conn.execute("UPDATE appointments SET status='cancelled' WHERE id=?", (appt_id,))
        conn.commit()
        return jsonify(ok=True)
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Admin
# --------------------------------------------------------------------------- #
@app.get("/api/admin/stats")
@login_required
@admin_required
def admin_stats():
    conn = get_db()
    try:
        total_patients = conn.execute("SELECT COUNT(*) c FROM users WHERE role='patient'").fetchone()["c"]
        total_doctors = conn.execute("SELECT COUNT(*) c FROM doctors WHERE active=1").fetchone()["c"]
        today_str = date_cls.today().isoformat()
        today_appts = conn.execute(
            "SELECT COUNT(*) c FROM appointments WHERE appt_date=? AND status='confirmed'",
            (today_str,)).fetchone()["c"]
        upcoming = conn.execute(
            "SELECT COUNT(*) c FROM appointments WHERE appt_date>=? AND status='confirmed'",
            (today_str,)).fetchone()["c"]
        return jsonify(stats={
            "total_patients": total_patients,
            "total_doctors": total_doctors,
            "today_appointments": today_appts,
            "upcoming_appointments": upcoming,
        })
    finally:
        conn.close()


@app.get("/api/admin/appointments")
@login_required
@admin_required
def admin_appointments():
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT a.*, u.name as patient_name, u.phone as patient_phone,
                   doc.name as doctor_name, d.name as department_name
            FROM appointments a
            JOIN users u ON u.id = a.user_id
            JOIN doctors doc ON doc.id = a.doctor_id
            JOIN departments d ON d.id = doc.department_id
            ORDER BY a.appt_date DESC, a.appt_time DESC
        """).fetchall()
        return jsonify(appointments=rows_to_list(rows))
    finally:
        conn.close()


@app.get("/api/admin/doctors")
@login_required
@admin_required
def admin_doctors():
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT doc.*, d.name as department_name
            FROM doctors doc JOIN departments d ON d.id = doc.department_id
            ORDER BY doc.name
        """).fetchall()
        return jsonify(doctors=rows_to_list(rows))
    finally:
        conn.close()


@app.post("/api/admin/doctors")
@login_required
@admin_required
def admin_add_doctor():
    data = request.get_json(force=True, silent=True) or {}
    required = ["name", "department_id", "qualification", "experience_years", "fee"]
    if not all(data.get(k) not in (None, "") for k in required):
        return jsonify(error="All doctor fields are required."), 400

    colors = ["#12463C", "#1B3A4B", "#5C2E7A", "#8A4B08", "#B23A48", "#2E8B84"]
    import random
    conn = get_db()
    try:
        cur = conn.execute(
            """INSERT INTO doctors (name, department_id, qualification, experience_years, fee, bio, avatar_color)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (data["name"], data["department_id"], data["qualification"],
             data["experience_years"], data["fee"], data.get("bio", ""),
             random.choice(colors)),
        )
        doctor_id = cur.lastrowid
        # default Mon-Fri 09:00-13:00 schedule for new doctors
        for weekday in range(0, 5):
            conn.execute(
                """INSERT INTO doctor_schedule (doctor_id, weekday, start_time, end_time, slot_minutes)
                   VALUES (?, ?, '09:00', '13:00', 20)""",
                (doctor_id, weekday),
            )
        conn.commit()
        return jsonify(ok=True, doctor_id=doctor_id), 201
    finally:
        conn.close()


@app.post("/api/admin/doctors/<int:doctor_id>/deactivate")
@login_required
@admin_required
def admin_deactivate_doctor(doctor_id):
    conn = get_db()
    try:
        conn.execute("UPDATE doctors SET active=0 WHERE id=?", (doctor_id,))
        conn.commit()
        return jsonify(ok=True)
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        init_db()
    app.run(debug=True, port=5000)
else:
    if not os.path.exists(DB_PATH):
        init_db()
