"""
Database layer for the Hospital Appointment Booking System.
SQLite via the stdlib sqlite3 module — no external DB server required.
"""
import sqlite3
import os
from datetime import datetime
from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hospital.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'patient',      -- 'patient' | 'admin'
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT
);

CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    qualification TEXT,
    experience_years INTEGER DEFAULT 0,
    fee INTEGER DEFAULT 0,
    bio TEXT,
    avatar_color TEXT DEFAULT '#12463C',
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS doctor_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    weekday INTEGER NOT NULL,          -- 0=Mon ... 6=Sun
    start_time TEXT NOT NULL,          -- 'HH:MM'
    end_time TEXT NOT NULL,            -- 'HH:MM'
    slot_minutes INTEGER NOT NULL DEFAULT 20,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    appt_date TEXT NOT NULL,           -- 'YYYY-MM-DD'
    appt_time TEXT NOT NULL,           -- 'HH:MM'
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',  -- 'confirmed' | 'cancelled' | 'completed'
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);
"""


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(reset=False):
    if reset and os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    fresh = not os.path.exists(DB_PATH)
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()

    if fresh:
        seed(conn)
    conn.close()


def seed(conn):
    now = datetime.utcnow().isoformat()

    departments = [
        ("Cardiology", "Heart & vascular health", "heart"),
        ("Neurology", "Brain, spine & nervous system", "brain"),
        ("Orthopedics", "Bones, joints & muscles", "bone"),
        ("Pediatrics", "Child & adolescent care", "child"),
        ("Dermatology", "Skin, hair & nails", "skin"),
        ("General Medicine", "Everyday health concerns", "stethoscope"),
        ("Dentistry", "Oral & dental care", "tooth"),
        ("Ophthalmology", "Eye care & vision", "eye"),
    ]
    conn.executemany(
        "INSERT INTO departments (name, description, icon) VALUES (?, ?, ?)",
        departments,
    )

    doctors = [
        # name, dept(1-indexed), qualification, exp, fee, bio, color
        ("Dr. Anjali Rao", 1, "MD, DM Cardiology", 14, 800,
         "Specialist in interventional cardiology and heart-failure management.", "#12463C"),
        ("Dr. Karthik Iyer", 1, "MBBS, MD Cardiology", 9, 650,
         "Focus on preventive cardiology and echocardiography.", "#1B3A4B"),
        ("Dr. Meera Nair", 2, "MD, DM Neurology", 12, 900,
         "Treats migraines, epilepsy and stroke recovery.", "#5C2E7A"),
        ("Dr. Sanjay Verma", 3, "MS Orthopedics", 16, 700,
         "Joint replacement and sports injury specialist.", "#8A4B08"),
        ("Dr. Priya Menon", 3, "MS Ortho, Fellowship Spine", 10, 750,
         "Spine care and minimally invasive orthopedic surgery.", "#8A4B08"),
        ("Dr. Ritu Sharma", 4, "MD Pediatrics", 11, 500,
         "Newborn to teen care with a gentle, family-first approach.", "#B23A48"),
        ("Dr. Farah Khan", 5, "MD Dermatology", 8, 600,
         "Medical and cosmetic dermatology, acne & skin allergies.", "#2E8B84"),
        ("Dr. Arvind Pillai", 6, "MBBS, MD Medicine", 20, 400,
         "General physician for everyday illness and checkups.", "#1B3A4B"),
        ("Dr. Neha Gupta", 7, "BDS, MDS", 7, 450,
         "Root canal, orthodontics and cosmetic dentistry.", "#12463C"),
        ("Dr. Rahul Desai", 8, "MS Ophthalmology", 13, 550,
         "Cataract surgery and comprehensive eye exams.", "#5C2E7A"),
    ]
    conn.executemany(
        """INSERT INTO doctors (name, department_id, qualification, experience_years, fee, bio, avatar_color)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        doctors,
    )

    # Standard schedule: Mon-Fri morning 09:00-13:00, Mon/Wed/Fri evening 16:00-19:00
    # Doctor ids will be 1..10 in insertion order.
    schedule_rows = []
    for doc_id in range(1, 11):
        for weekday in range(0, 5):  # Mon-Fri
            schedule_rows.append((doc_id, weekday, "09:00", "13:00", 20))
        if doc_id % 2 == 0:
            for weekday in (0, 2, 4):
                schedule_rows.append((doc_id, weekday, "16:00", "19:00", 20))
        else:
            for weekday in (1, 3):
                schedule_rows.append((doc_id, weekday, "16:00", "19:00", 20))
    conn.executemany(
        """INSERT INTO doctor_schedule (doctor_id, weekday, start_time, end_time, slot_minutes)
           VALUES (?, ?, ?, ?, ?)""",
        schedule_rows,
    )

    # Seed one admin account: admin@hospital.com / admin123
    conn.execute(
        """INSERT INTO users (name, email, phone, password_hash, role, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        ("Hospital Admin", "admin@hospital.com", "0000000000",
         generate_password_hash("admin123"), "admin", now),
    )

    conn.commit()


if __name__ == "__main__":
    init_db(reset=True)
    print(f"Database initialized at {DB_PATH}")
