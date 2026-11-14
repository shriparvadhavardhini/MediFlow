/* =========================================================================
   MediFlow — frontend application logic
   No framework: small state object + direct DOM updates.
   ========================================================================= */
(() => {
  "use strict";

  const state = {
    user: null,
    departments: [],
    doctors: [],
    view: "home",
    wizard: {
      step: 1,
      departmentId: null,
      doctor: null,
      date: null,
      time: null,
      reason: "",
    },
  };

  const WIZ_STEPS = [
    { n: 1, label: "Department" },
    { n: 2, label: "Doctor" },
    { n: 3, label: "Date & time" },
    { n: 4, label: "Details" },
    { n: 5, label: "Confirmed" },
  ];

  // ------------------------------------------------------------------- //
  // Fetch helper
  // ------------------------------------------------------------------- //
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...options,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      throw new Error(data.error || "Something went wrong. Please try again.");
    }
    return data;
  }

  // ------------------------------------------------------------------- //
  // Toasts
  // ------------------------------------------------------------------- //
  function toast(message, type = "") {
    const region = document.getElementById("toast-region");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    region.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  // ------------------------------------------------------------------- //
  // View routing
  // ------------------------------------------------------------------- //
  function goTo(view) {
    if ((view === "appointments" || view === "book" || view === "admin") && !state.user) {
      openAuthModal("login");
      toast("Log in to continue.");
      return;
    }
    if (view === "admin" && state.user?.role !== "admin") {
      toast("Admin access required.", "error");
      return;
    }
    state.view = view;
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.dataset.view === view));
    document.querySelectorAll(".nav-link").forEach(l => l.classList.toggle("active", l.dataset.nav === view));
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.location.hash = view;

    if (view === "browse") loadBrowseView();
    if (view === "book") startWizard();
    if (view === "appointments") loadAppointments();
    if (view === "admin") loadAdmin();
  }

  window.addEventListener("hashchange", () => {
    const v = window.location.hash.replace("#", "") || "home";
    if (document.querySelector(`.view[data-view="${v}"]`)) goTo(v);
  });

  document.querySelectorAll("[data-nav]").forEach(el => {
    el.addEventListener("click", e => { e.preventDefault(); goTo(el.dataset.nav); });
  });
  document.querySelectorAll("[data-go]").forEach(el => {
    el.addEventListener("click", () => goTo(el.dataset.go));
  });

  // ------------------------------------------------------------------- //
  // Auth
  // ------------------------------------------------------------------- //
  const authModal = document.getElementById("auth-modal");
  function openAuthModal(tab = "login") {
    authModal.classList.remove("hidden");
    setAuthTab(tab);
    document.getElementById("auth-msg").innerHTML = "";
  }
  function closeAuthModal() { authModal.classList.add("hidden"); }
  document.getElementById("btn-login").addEventListener("click", () => openAuthModal("login"));
  document.getElementById("btn-signup").addEventListener("click", () => openAuthModal("signup"));
  document.getElementById("auth-close").addEventListener("click", closeAuthModal);
  authModal.addEventListener("click", e => { if (e.target === authModal) closeAuthModal(); });

  function setAuthTab(tab) {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.toggle("active", t.dataset.authTab === tab));
    document.querySelectorAll(".auth-form").forEach(f => f.classList.toggle("active", f.dataset.form === tab));
  }
  document.querySelectorAll(".auth-tab").forEach(t => t.addEventListener("click", () => setAuthTab(t.dataset.authTab)));

  function showAuthMsg(msg, type) {
    document.getElementById("auth-msg").innerHTML = `<div class="form-msg ${type}">${escapeHtml(msg)}</div>`;
  }

  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const { user } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("login-email").value,
          password: document.getElementById("login-password").value,
        }),
      });
      onAuthSuccess(user, "Welcome back.");
    } catch (err) { showAuthMsg(err.message, "error"); }
  });

  document.getElementById("signup-form").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const { user } = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("signup-name").value,
          email: document.getElementById("signup-email").value,
          phone: document.getElementById("signup-phone").value,
          password: document.getElementById("signup-password").value,
        }),
      });
      onAuthSuccess(user, "Account created.");
    } catch (err) { showAuthMsg(err.message, "error"); }
  });

  function onAuthSuccess(user, message) {
    state.user = user;
    renderNavUser();
    closeAuthModal();
    toast(message, "success");
    if (user.role === "admin") goTo("admin"); else goTo("browse");
  }

  function renderNavUser() {
    const actions = document.getElementById("nav-actions");
    const adminLink = document.getElementById("admin-nav-link");
    if (state.user) {
      const initials = state.user.name.split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase();
      actions.innerHTML = `
        <div class="nav-user">
          <div class="nav-avatar">${initials}</div>
          <span style="font-size:13.5px;font-weight:600;color:var(--ink-700)">${escapeHtml(state.user.name.split(" ")[0])}</span>
        </div>
        <button class="btn btn-ghost btn-sm" id="btn-logout">Log out</button>
      `;
      document.getElementById("btn-logout").addEventListener("click", async () => {
        await api("/api/auth/logout", { method: "POST" });
        state.user = null;
        renderNavUser();
        toast("Logged out.");
        goTo("home");
      });
      adminLink.classList.toggle("hidden", state.user.role !== "admin");
    } else {
      actions.innerHTML = `
        <button class="btn btn-ghost btn-sm" id="btn-login">Log in</button>
        <button class="btn btn-dark btn-sm" id="btn-signup">Sign up</button>
      `;
      document.getElementById("btn-login").addEventListener("click", () => openAuthModal("login"));
      document.getElementById("btn-signup").addEventListener("click", () => openAuthModal("signup"));
      adminLink.classList.add("hidden");
    }
  }

  // ------------------------------------------------------------------- //
  // Helpers
  // ------------------------------------------------------------------- //
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function initials(name) { return name.split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase(); }
  function fmtTime12(t) {
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }
  function fmtDateLong(dStr) {
    const d = new Date(dStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  const DEPT_ICONS = {
    heart: "M12 21s-7.5-4.6-10-9.2C.5 8.2 2.4 4 6.5 4c2 0 3.6 1.2 4.5 2.6C11.9 5.2 13.5 4 15.5 4 19.6 4 21.5 8.2 20 11.8 19.5 15.4 12 21 12 21z",
    brain: "M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8 3 3 0 0 0 1.3 4.9A3 3 0 0 0 8 20h1v-8m3-8a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8 3 3 0 0 1-1.3 4.9A3 3 0 0 1 16 20h-1v-8m-3-8v16",
    bone: "M8.5 8.5 15.5 15.5M4.9 4.9a2.5 2.5 0 1 1 3.6 3.5L7 9.9 5.5 8.4a2.5 2.5 0 0 1-.6-3.5zM19.1 19.1a2.5 2.5 0 1 1-3.6-3.5L17 14.1l1.5 1.5a2.5 2.5 0 0 1 .6 3.5z",
    child: "M12 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM7 21v-6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v6M9 21v-3M15 21v-3",
    skin: "M12 3c4 3 7 6.5 7 10.5A7 7 0 0 1 5 13.5C5 9.5 8 6 12 3z",
    stethoscope: "M6 3v6a4 4 0 0 0 8 0V3M6 6H4M14 6h2M10 13v3a5 5 0 0 0 10 0v-1M20 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    tooth: "M12 3c-2.5 0-5 1.6-5 5 0 2 .6 3 1 5s.5 6 2 6 1.5-4 2-4 1.5 4 2 4 1.6-4 2-6 1-3 1-5c0-3.4-2.5-5-5-5z",
    eye: "M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  };
  function iconSvg(key) {
    const path = DEPT_ICONS[key] || DEPT_ICONS.stethoscope;
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  }

  // ------------------------------------------------------------------- //
  // Data loading
  // ------------------------------------------------------------------- //
  async function loadDepartments() {
    if (state.departments.length) return state.departments;
    const { departments } = await api("/api/departments");
    state.departments = departments;
    return departments;
  }

  function deptCardHtml(d, forWizard) {
    return `
      <button class="dept-card" data-dept-id="${d.id}" ${forWizard ? "" : `onclick="window.__browseDept(${d.id})"`}>
        <div class="dept-icon">${iconSvg(d.icon)}</div>
        <h4>${escapeHtml(d.name)}</h4>
        <p>${escapeHtml(d.description || "")}</p>
        <div class="dept-count">${d.doctor_count} specialist${d.doctor_count === 1 ? "" : "s"}</div>
      </button>`;
  }

  window.__browseDept = (id) => {
    goTo("browse");
    setTimeout(() => selectBrowseDept(id), 50);
  };

  async function renderHomeDepartments() {
    const grid = document.getElementById("home-dept-grid");
    const departments = await loadDepartments();
    grid.innerHTML = departments.map(d => deptCardHtml(d, false)).join("");
    document.getElementById("stat-doctors").textContent =
      departments.reduce((s, d) => s + d.doctor_count, 0) + "+";
  }

  // ------------------------------------------------------------------- //
  // Browse view
  // ------------------------------------------------------------------- //
  let browseActiveDept = null;
  async function loadBrowseView() {
    const departments = await loadDepartments();
    const pillWrap = document.getElementById("browse-dept-pills");
    pillWrap.innerHTML = `<button class="pill ${!browseActiveDept ? "selected" : ""}" data-dept="all">All departments</button>` +
      departments.map(d => `<button class="pill ${browseActiveDept == d.id ? "selected" : ""}" data-dept="${d.id}">${escapeHtml(d.name)}</button>`).join("");
    pillWrap.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => {
        browseActiveDept = p.dataset.dept === "all" ? null : p.dataset.dept;
        loadBrowseView();
      });
    });
    await renderBrowseDoctors();
  }

  function selectBrowseDept(id) {
    browseActiveDept = id;
    loadBrowseView();
  }

  async function renderBrowseDoctors() {
    const grid = document.getElementById("browse-doctor-grid");
    grid.innerHTML = `<div class="loading-row">Loading doctors…</div>`;
    const q = browseActiveDept ? `?department_id=${browseActiveDept}` : "";
    const { doctors } = await api(`/api/doctors${q}`);
    if (!doctors.length) {
      grid.innerHTML = `<div class="loading-row">No doctors found in this department.</div>`;
      return;
    }
    grid.innerHTML = doctors.map(doc => `
      <div class="doctor-card">
        <div class="doctor-top">
          <div class="doctor-avatar" style="background:${doc.avatar_color}">${initials(doc.name)}</div>
          <div>
            <div class="doctor-name">${escapeHtml(doc.name)}</div>
            <div class="doctor-dept">${escapeHtml(doc.department_name)}</div>
          </div>
        </div>
        <div class="doctor-meta">
          <span>${escapeHtml(doc.qualification || "")}</span>
          <span><b>${doc.experience_years}</b> yrs exp</span>
          <span><b>₹${doc.fee}</b> fee</span>
        </div>
        <p class="doctor-bio">${escapeHtml(doc.bio || "")}</p>
        <button class="btn btn-dark btn-sm" onclick="window.__bookDoctor(${doc.id}, ${doc.department_id})">Book appointment</button>
      </div>
    `).join("");
  }

  window.__bookDoctor = (doctorId, deptId) => {
    if (!state.user) { openAuthModal("login"); toast("Log in to book an appointment."); return; }
    state.wizard = { step: 2, departmentId: deptId, doctor: null, date: null, time: null, reason: "" };
    goTo("book");
    setTimeout(async () => {
      await renderWizardDoctorStep();
      const target = state.doctors.find(d => d.id === doctorId);
      if (target) selectWizardDoctor(target);
    }, 30);
  };

  // ------------------------------------------------------------------- //
  // Booking wizard
  // ------------------------------------------------------------------- //
  function renderWizardProgress() {
    const wrap = document.getElementById("wizard-progress");
    wrap.innerHTML = WIZ_STEPS.map((s, i) => {
      const cls = s.n < state.wizard.step ? "done" : s.n === state.wizard.step ? "current" : "";
      const connector = i < WIZ_STEPS.length - 1
        ? `<div class="wp-connector ${s.n < state.wizard.step ? "filled" : ""}"></div>` : "";
      return `<div class="wp-step ${cls}"><div class="wp-num">${s.n < state.wizard.step ? "✓" : s.n}</div><span class="wp-label">${s.label}</span></div>${connector}`;
    }).join("");
  }

  function showWizardStep(n) {
    document.querySelectorAll(".wizard-step").forEach(el => el.classList.toggle("active", Number(el.dataset.step) === n));
    renderWizardProgress();
    const backBtn = document.getElementById("wiz-back");
    const nextBtn = document.getElementById("wiz-next");
    backBtn.style.visibility = n === 1 ? "hidden" : "visible";
    if (n === 5) {
      backBtn.style.visibility = "hidden";
      nextBtn.textContent = "Done";
    } else if (n === 4) {
      nextBtn.textContent = "Confirm booking";
    } else {
      nextBtn.textContent = "Continue";
    }
  }

  async function startWizard() {
    if (!state.wizard.departmentId) {
      state.wizard = { step: 1, departmentId: null, doctor: null, date: null, time: null, reason: "" };
    }
    await renderWizardDeptStep();
    showWizardStep(state.wizard.step);
  }

  async function renderWizardDeptStep() {
    const departments = await loadDepartments();
    const wrap = document.getElementById("wiz-dept-pills");
    wrap.innerHTML = departments.map(d =>
      `<button class="pill ${state.wizard.departmentId === d.id ? "selected" : ""}" data-dept="${d.id}">${escapeHtml(d.name)}</button>`
    ).join("");
    wrap.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => {
        state.wizard.departmentId = Number(p.dataset.dept);
        state.wizard.doctor = null;
        wrap.querySelectorAll(".pill").forEach(x => x.classList.remove("selected"));
        p.classList.add("selected");
      });
    });
  }

  async function renderWizardDoctorStep() {
    const wrap = document.getElementById("wiz-doctor-list");
    wrap.innerHTML = `<div class="loading-row">Loading doctors…</div>`;
    const { doctors } = await api(`/api/doctors?department_id=${state.wizard.departmentId}`);
    state.doctors = doctors;
    if (!doctors.length) {
      wrap.innerHTML = `<div class="loading-row">No doctors available in this department yet.</div>`;
      return;
    }
    wrap.innerHTML = doctors.map(doc => `
      <button class="doc-pick ${state.wizard.doctor?.id === doc.id ? "selected" : ""}" data-doc-id="${doc.id}">
        <div class="doctor-avatar" style="background:${doc.avatar_color}">${initials(doc.name)}</div>
        <div class="doc-pick-info">
          <b>${escapeHtml(doc.name)}</b>
          <span>${escapeHtml(doc.qualification || "")} · ${doc.experience_years} yrs exp</span>
        </div>
        <div class="doc-pick-fee">₹${doc.fee}</div>
      </button>
    `).join("");
    wrap.querySelectorAll(".doc-pick").forEach(btn => {
      btn.addEventListener("click", () => {
        const doc = doctors.find(d => d.id === Number(btn.dataset.docId));
        selectWizardDoctor(doc);
      });
    });
  }

  function selectWizardDoctor(doc) {
    state.wizard.doctor = doc;
    document.querySelectorAll(".doc-pick").forEach(el => el.classList.toggle("selected", Number(el.dataset.docId) === doc.id));
  }

  function renderWizardDateStrip() {
    const wrap = document.getElementById("wiz-date-strip");
    const days = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    wrap.innerHTML = days.map(d => {
      const iso = d.toISOString().slice(0, 10);
      const wd = d.toLocaleDateString(undefined, { weekday: "short" });
      const dayNum = d.getDate();
      const selected = state.wizard.date === iso ? "selected" : "";
      return `<button class="date-chip ${selected}" data-date="${iso}"><span>${wd}</span><b>${dayNum}</b></button>`;
    }).join("");
    wrap.querySelectorAll(".date-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        state.wizard.date = chip.dataset.date;
        state.wizard.time = null;
        wrap.querySelectorAll(".date-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
        loadWizardSlots();
      });
    });
  }

  async function loadWizardSlots() {
    const grid = document.getElementById("wiz-slot-grid");
    if (!state.wizard.date) { grid.innerHTML = ""; return; }
    grid.innerHTML = `<div class="loading-row">Checking availability…</div>`;
    const { slots } = await api(`/api/slots?doctor_id=${state.wizard.doctor.id}&date=${state.wizard.date}`);
    if (!slots.length) {
      grid.innerHTML = `<div class="slot-empty">No open slots this day. Try another date.</div>`;
      return;
    }
    grid.innerHTML = slots.map(t =>
      `<button class="slot-btn ${state.wizard.time === t ? "selected" : ""}" data-time="${t}">${fmtTime12(t)}</button>`
    ).join("");
    grid.querySelectorAll(".slot-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.wizard.time = btn.dataset.time;
        grid.querySelectorAll(".slot-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
    });
  }

  function renderWizardSummary(targetId) {
    const w = state.wizard;
    document.getElementById(targetId).innerHTML = `
      <div class="summary-row"><span>Doctor</span><span>${escapeHtml(w.doctor.name)}</span></div>
      <div class="summary-row"><span>Department</span><span>${escapeHtml(w.doctor.department_name)}</span></div>
      <div class="summary-row"><span>Date</span><span>${fmtDateLong(w.date)}</span></div>
      <div class="summary-row"><span>Time</span><span>${fmtTime12(w.time)}</span></div>
      <div class="summary-row"><span>Consultation fee</span><span>₹${w.doctor.fee}</span></div>
    `;
  }

  document.getElementById("wiz-back").addEventListener("click", () => {
    if (state.wizard.step > 1) {
      state.wizard.step -= 1;
      showWizardStep(state.wizard.step);
    }
  });

  document.getElementById("wiz-next").addEventListener("click", async () => {
    const w = state.wizard;
    if (w.step === 1) {
      if (!w.departmentId) { toast("Choose a department to continue.", "error"); return; }
      w.step = 2;
      await renderWizardDoctorStep();
    } else if (w.step === 2) {
      if (!w.doctor) { toast("Select a doctor to continue.", "error"); return; }
      w.step = 3;
      renderWizardDateStrip();
      document.getElementById("wiz-slot-grid").innerHTML = "";
    } else if (w.step === 3) {
      if (!w.date || !w.time) { toast("Pick a date and time to continue.", "error"); return; }
      w.step = 4;
      renderWizardSummary("wiz-summary");
    } else if (w.step === 4) {
      w.reason = document.getElementById("wiz-reason").value.trim();
      try {
        document.getElementById("wiz-next").setAttribute("disabled", "true");
        await api("/api/appointments", {
          method: "POST",
          body: JSON.stringify({ doctor_id: w.doctor.id, date: w.date, time: w.time, reason: w.reason }),
        });
        w.step = 5;
        renderWizardSummary("wiz-confirm-summary");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        document.getElementById("wiz-next").removeAttribute("disabled");
      }
    } else if (w.step === 5) {
      goTo("appointments");
      return;
    }
    showWizardStep(w.step);
  });

  // ------------------------------------------------------------------- //
  // My appointments
  // ------------------------------------------------------------------- //
  async function loadAppointments() {
    const list = document.getElementById("appt-list");
    list.innerHTML = `<div class="loading-row">Loading…</div>`;
    const { appointments } = await api("/api/appointments/mine");
    if (!appointments.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
          <h3>No appointments yet</h3>
          <p>When you book a visit, it'll show up here.</p>
        </div>`;
      return;
    }
    list.innerHTML = appointments.map(a => {
      const d = new Date(a.appt_date + "T00:00:00");
      return `
      <div class="appt-card">
        <div class="appt-date-block">
          <span>${d.toLocaleDateString(undefined, { month: "short" })}</span>
          <b>${d.getDate()}</b>
        </div>
        <div class="appt-info">
          <b>${escapeHtml(a.doctor_name)}</b>
          <p>${escapeHtml(a.department_name)}${a.reason ? " · " + escapeHtml(a.reason) : ""}</p>
        </div>
        <div class="appt-time mono">${fmtTime12(a.appt_time)}</div>
        <span class="status-badge status-${a.status}">${a.status}</span>
        ${a.status === "confirmed" ? `<button class="btn btn-danger-ghost btn-sm" data-cancel="${a.id}">Cancel</button>` : ""}
      </div>`;
    }).join("");
    list.querySelectorAll("[data-cancel]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Cancel this appointment?")) return;
        try {
          await api(`/api/appointments/${btn.dataset.cancel}/cancel`, { method: "POST" });
          toast("Appointment cancelled.", "success");
          loadAppointments();
        } catch (err) { toast(err.message, "error"); }
      });
    });
  }

  // ------------------------------------------------------------------- //
  // Admin
  // ------------------------------------------------------------------- //
  async function loadAdmin() {
    const { stats } = await api("/api/admin/stats");
    document.getElementById("admin-stats").innerHTML = `
      <div class="stat-card"><span>Today's appointments</span><b>${stats.today_appointments}</b></div>
      <div class="stat-card"><span>Upcoming appointments</span><b>${stats.upcoming_appointments}</b></div>
      <div class="stat-card"><span>Active doctors</span><b>${stats.total_doctors}</b></div>
      <div class="stat-card"><span>Registered patients</span><b>${stats.total_patients}</b></div>
    `;
    await loadAdminAppointments();
    await populateAdminDeptSelect();
    await loadAdminDoctors();
  }

  async function loadAdminAppointments() {
    const body = document.getElementById("admin-appt-body");
    const { appointments } = await api("/api/admin/appointments");
    if (!appointments.length) {
      body.innerHTML = `<tr><td colspan="6" class="loading-row">No appointments yet.</td></tr>`;
      return;
    }
    body.innerHTML = appointments.map(a => `
      <tr>
        <td><b>${escapeHtml(a.patient_name)}</b><br><span style="color:var(--ink-500);font-size:12.5px">${escapeHtml(a.patient_phone || "")}</span></td>
        <td>${escapeHtml(a.doctor_name)}</td>
        <td>${escapeHtml(a.department_name)}</td>
        <td class="mono">${a.appt_date}</td>
        <td class="mono">${fmtTime12(a.appt_time)}</td>
        <td><span class="status-badge status-${a.status}">${a.status}</span></td>
      </tr>`).join("");
  }

  async function populateAdminDeptSelect() {
    const departments = await loadDepartments();
    const sel = document.getElementById("ad-dept");
    sel.innerHTML = departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
  }

  async function loadAdminDoctors() {
    const body = document.getElementById("admin-doctor-body");
    const { doctors } = await api("/api/admin/doctors");
    body.innerHTML = doctors.map(d => `
      <tr>
        <td><b>${escapeHtml(d.name)}</b></td>
        <td>${escapeHtml(d.department_name)}</td>
        <td>${escapeHtml(d.qualification || "")}</td>
        <td>${d.experience_years} yrs</td>
        <td class="mono">₹${d.fee}</td>
      </tr>`).join("");
  }

  document.querySelectorAll(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("admin-panel-appointments").classList.toggle("hidden", tab.dataset.adminTab !== "appointments");
      document.getElementById("admin-panel-doctors").classList.toggle("hidden", tab.dataset.adminTab !== "doctors");
    });
  });

  document.getElementById("admin-add-doctor-form").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("/api/admin/doctors", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("ad-name").value,
          department_id: document.getElementById("ad-dept").value,
          qualification: document.getElementById("ad-qual").value,
          experience_years: document.getElementById("ad-exp").value,
          fee: document.getElementById("ad-fee").value,
          bio: document.getElementById("ad-bio").value,
        }),
      });
      toast("Doctor added.", "success");
      e.target.reset();
      loadAdminDoctors();
    } catch (err) { toast(err.message, "error"); }
  });

  // ------------------------------------------------------------------- //
  // Clock (decorative, hero panel)
  // ------------------------------------------------------------------- //
  function tickClock() {
    const el = document.getElementById("clock");
    if (el) el.textContent = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  setInterval(tickClock, 1000 * 30);
  tickClock();

  // ------------------------------------------------------------------- //
  // Boot
  // ------------------------------------------------------------------- //
  async function boot() {
    try {
      const { user } = await api("/api/auth/me");
      state.user = user;
      renderNavUser();
    } catch (e) { /* not logged in */ }

    await renderHomeDepartments();

    const startView = window.location.hash.replace("#", "") || "home";
    goTo(document.querySelector(`.view[data-view="${startView}"]`) ? startView : "home");
  }

  boot();
})();
