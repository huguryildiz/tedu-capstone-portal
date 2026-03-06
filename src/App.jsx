// src/App.jsx
// ============================================================
// Root component — manages top-level page routing.
//
// Pages: "home" | "jury" | "admin"
//
// Security: admin password is stored in a useRef (not useState)
// so it is never serialised into the React DevTools component
// tree as readable plaintext. Cleared when leaving admin.
//
// Home "Resume" banner removed in v5 — draft continuity is now
// handled inside the jury flow after PIN verification.
// Note: localStorage is used only for same-device convenience
// (juror_id + semester_id), not as a source of truth.
// ============================================================

import { useEffect, useRef, useState } from "react";
import JuryForm   from "./JuryForm";
import AdminPanel from "./AdminPanel";
import {
  ClipboardIcon,
  InfoIcon,
  ShieldUserIcon,
  AlertCircleIcon,
  EyeIcon,
  EyeOffIcon,
} from "./shared/Icons";
import MinimalLoaderOverlay from "./shared/MinimalLoaderOverlay";
import "./styles/home.css";

import teduLogo from "./assets/tedu-logo.png";

export default function App() {
  const [page,           setPage]          = useState(() => {
    try {
      const saved = localStorage.getItem("tedu_portal_page");
      if (saved === "home" || saved === "jury" || saved === "admin") return saved;
    } catch {}
    return "home";
  });
  const adminPassRef     = useRef("");
  const [adminUnlocked,  setAdminUnlocked]  = useState(false);
  const [adminChecking,  setAdminChecking]  = useState(false);
  const [adminInput,     setAdminInput]     = useState("");
  const [adminAuthError, setAdminAuthError] = useState("");
  const [adminShowPass,  setAdminShowPass]  = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("tedu_portal_page", page);
    } catch {}
  }, [page]);
  
  function handleAdminLogin() {
    const pass = adminInput.trim();
    if (!pass) { setAdminAuthError("Please enter the admin password."); return; }
    adminPassRef.current = pass;
    setAdminInput("");
    setAdminAuthError("");
    setAdminChecking(true);
    setAdminUnlocked(true);
  }

  function handleAuthFail(msg) {
    setAdminUnlocked(false);
    setAdminChecking(false);
    adminPassRef.current = "";
    setAdminAuthError(msg || "Authentication failed.");
  }

  

  // ── Jury form ─────────────────────────────────────────────
  if (page === "jury") {
    return (
      <JuryForm
        onBack={() => setPage("home")}
      />
    );
  }

  // ── Admin panel ───────────────────────────────────────────
  if (page === "admin") {
    if (!adminUnlocked) {
      return (
        <div className="premium-screen">
          <div className="premium-card">
            <div className="premium-header">
              <div className="premium-icon-square" aria-hidden="true"><ShieldUserIcon /></div>
              <div className="premium-title">Admin Panel</div>
              <div className="premium-subtitle">Enter the admin password to access the results and management panel.</div>
            </div>
            <div className="premium-input-wrap">
              <input
                type={adminShowPass ? "text" : "password"}
                placeholder="Admin password"
                value={adminInput}
                onChange={(e) => {
                  setAdminInput(e.target.value);
                  if (adminAuthError) setAdminAuthError("");
                }}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdminLogin(); }}
                autoComplete="current-password"
                autoFocus
                className="premium-input"
              />
              <button
                type="button"
                className="premium-input-toggle"
                onClick={() => setAdminShowPass((v) => !v)}
                aria-label={adminShowPass ? "Hide password" : "Show password"}
                title={adminShowPass ? "Hide password" : "Show password"}
              >
                {adminShowPass ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {adminAuthError && (
              <div className="premium-error-banner" role="alert">
                <AlertCircleIcon />
                <span>{adminAuthError}</span>
              </div>
            )}
            <button className="premium-btn-primary" onClick={handleAdminLogin} disabled={adminChecking}>
              Log In
            </button>
            <button className="premium-btn-link" onClick={() => { setPage("home"); setAdminAuthError(""); }}>
              ← Return Home
            </button>
          
          </div>
        </div>
      );
    }

    return (
      <>
        {/* Checking… overlay — shown while the first fetch is in flight */}
        {adminChecking && (
          <MinimalLoaderOverlay open={adminChecking} minDuration={400} />
        )}
        <AdminPanel
          adminPass={adminPassRef.current}
          onAuthError={handleAuthFail}
          onInitialLoadDone={() => setAdminChecking(false)}
          onBack={() => {
            setPage("home");
            setAdminUnlocked(false);
            setAdminChecking(false);
            setAdminAuthError("");
            adminPassRef.current = "";
          }}
        />
      </>
    );
  }

  // ── Home page ─────────────────────────────────────────────
  return (
    <div className="home">
      <div className="home-bg" />
      <div className="home-card">

        <div className="home-logo-wrap">
          <img className="home-logo" src={teduLogo} alt="TED University" loading="eager" />
        </div>

        <h1>Senior Project Poster Day Jury Portal</h1>

        <p className="home-sub">
          TED University <br/> Dept. of Electrical and Electronics Engineering
        </p>

        <div className="home-buttons">
          <button
            className="btn-primary big home-primary-btn"
            onClick={() => setPage("jury")}
          >
            <span className="home-btn-icon" aria-hidden="true"><ClipboardIcon /></span>
            Start Evaluation
          </button>
          <button className="btn-outline big home-secondary-btn" onClick={() => setPage("admin")}>
            <span className="home-btn-icon" aria-hidden="true"><ShieldUserIcon /></span>
            Admin Panel
          </button>
        </div>

        <div className="home-info">
          <span className="home-info-icon" aria-hidden="true"><InfoIcon /></span>
          <span>Use the Evaluation Form to score each project group.</span>
        </div>

        <div className="home-footer">
          © 2026 · Developed by{" "}
          <a
            className="home-footer-link"
            href="https://huguryildiz.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Huseyin Ugur Yildiz
          </a>
          {" "}· v1.0
        </div>

      </div>
    </div>
  );
}
