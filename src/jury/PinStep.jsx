// src/jury/PinStep.jsx
// ============================================================
// PIN authentication screen.
//
// pinStep values:
//   "new"      — First login: display the generated PIN once so
//                the juror can save it. Continues on acknowledge.
//   "entering" — Returning juror: enter 4-digit PIN, then press
//                the OK button to submit.  Auto-submit on the
//                4th digit is intentionally removed — it caused
//                unintended submissions when users mis-typed and
//                quickly corrected the last digit.
//   "locked"   — Too many failed attempts. Admin must reset.
// ============================================================

import { useState, useRef, useEffect } from "react";
import {
  KeyIcon,
  KeyRoundIcon,
  LockIcon,
  ClipboardIcon,
  AlertCircleIcon,
} from "../shared/Icons";
import MinimalLoaderOverlay from "../shared/MinimalLoaderOverlay";

// ── 4-box PIN input with explicit OK button ───────────────────
function PinBoxes({ onSubmit, pinError, shake }) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const inputRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  // Reset boxes whenever an error is shown so the user can retry cleanly.
  useEffect(() => {
    if (pinError) {
      setDigits(["", "", "", ""]);
      setTimeout(() => inputRefs[0].current?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinError]);

  function handleChange(i, val) {
    const d    = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i]    = d;
    setDigits(next);
    if (d && i < 3) inputRefs[i + 1].current?.focus();
    // No auto-submit — user must press OK.
  }

  function handleKeyDown(i, e) {
    if (e.key === "Backspace") {
      if (digits[i] === "" && i > 0) {
        const next  = [...digits];
        next[i - 1] = "";
        setDigits(next);
        inputRefs[i - 1].current?.focus();
      } else {
        const next = [...digits];
        next[i]    = "";
        setDigits(next);
      }
    }
    if (e.key === "ArrowLeft"  && i > 0) inputRefs[i - 1].current?.focus();
    if (e.key === "ArrowRight" && i < 3) inputRefs[i + 1].current?.focus();
    // Enter key triggers submit if all boxes filled
    if (e.key === "Enter") {
      const pin = digits.join("");
      if (pin.length === 4) onSubmit(pin);
    }
  }

  function handlePaste(e) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (text.length === 4) {
      const next = text.split("");
      setDigits(next);
      inputRefs[3].current?.focus();
    }
    e.preventDefault();
  }

  function handleOk() {
    const pin = digits.join("");
    if (pin.length === 4) onSubmit(pin);
  }

  const isComplete = digits.every((d) => d !== "");

  return (
    <div className={`pin-input-group${shake ? " pin-input-group--shake" : ""}`}>
      <div className="pin-boxes-row">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={inputRefs[i]}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={d}
            autoFocus={i === 0}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-lpignore="true"
            data-form-type="other"
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            className={`pin-box${pinError ? " pin-box--error" : ""}`}
          />
        ))}
      </div>
      <button
        className="premium-btn-primary pin-ok-btn"
        onClick={handleOk}
        disabled={!isComplete}
      >
        Verify PIN →
      </button>
    </div>
  );
}

function AuthOverlay({ open }) {
  return <MinimalLoaderOverlay open={open} minDuration={400} />;
}

export default function PinStep({
  pinStep,
  pinError,
  newPin,
  attemptsLeft,
    onPinSubmit,       // (pin: string) => void
  onPinAcknowledge,  // () => void
}) {
  const [copied, setCopied] = useState(false);
  const [shake, setShake] = useState(false);
  const [authOverlay, setAuthOverlay] = useState({ open: false, stage: "idle" });
  const authRef = useRef({ seq: 0, start: 0, active: false });
  const pinErrorRef = useRef(pinError);
  const pinStepRef = useRef(pinStep);
  const stageStartRef = useRef(0);

  const handleCopy = async () => {
    const text = String(newPin || "");
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
        return;
      }
    } catch {}
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.top = "-9999px";
      el.style.left = "-9999px";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      el.setSelectionRange(0, el.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  const attemptsLeftNum = Number.isFinite(attemptsLeft) ? attemptsLeft : null;

  useEffect(() => {
    if (!pinError) return;
    setShake(false);
    const raf = requestAnimationFrame(() => setShake(true));
    const t = setTimeout(() => setShake(false), 260);
    try {
      if (navigator?.vibrate) navigator.vibrate([60, 40, 60]);
    } catch {}
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [pinError, attemptsLeft]);

  useEffect(() => {
    pinErrorRef.current = pinError;
  }, [pinError]);

  useEffect(() => {
    pinStepRef.current = pinStep;
  }, [pinStep]);

  useEffect(() => {
    if (!authOverlay.open) {
      document.body.classList.remove("auth-overlay-open");
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("auth-overlay-open");
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("auth-overlay-open");
    };
  }, [authOverlay.open]);

  const setStage = (stage, open = true) => {
    stageStartRef.current = Date.now();
    setAuthOverlay({ open, stage });
  };

  const beginAuthOverlay = () => {
    const seq = authRef.current.seq + 1;
    authRef.current = { seq, start: Date.now(), active: true };
    document.body.classList.add("auth-overlay-open");
    setStage("checking", true);
    return seq;
  };

  const closeAuthOverlay = (seq) => {
    if (authRef.current.seq !== seq) return;
    authRef.current.active = false;
    setStage("idle", false);
  };

  // ── New PIN: show once ────────────────────────────────────
  if (pinStep === "new") {
    const overlay = <AuthOverlay open={authOverlay.open} />;
    return (
      <>
        <div className="premium-screen">
          <div className="premium-card">
            <div className="premium-header">
              <div className="premium-icon-square" aria-hidden="true">
                <KeyRoundIcon />
              </div>
              <div className="premium-title">Secure Access PIN</div>
            </div>
            <p className="premium-body">
              This 4-digit PIN protects your evaluation session. You’ll need it when signing in from another device.
            </p>

            <div className="pin-display" aria-label="Your PIN">
              {String(newPin).split("").map((d, i) => (
                <span key={i} className="pin-digit">{d}</span>
              ))}
            </div>

            <button className="premium-btn-secondary" onClick={handleCopy} type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy-icon lucide-copy" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              {copied ? "Copied" : "Copy PIN"}
            </button>

          <div className="premium-info-strip">
            <span className="info-strip-icon" aria-hidden="true"><KeyIcon /></span>
                          <span>Keep your PIN private. If you lose it, contact the administrator to reset access.</span>
                      </div>

            <button className="premium-btn-primary" onClick={onPinAcknowledge}>
I’ve saved my PIN —               Continue →
            </button>
          </div>
        </div>
        {overlay}
      </>
    );
  }

  // ── Locked ────────────────────────────────────────────────
  if (pinStep === "locked") {
    const overlay = <AuthOverlay open={authOverlay.open} />;
    return (
      <>
        <div className="premium-screen">
          <div className="premium-card">
            <div className="premium-header">
              <div className="premium-icon-square" aria-hidden="true">
                <LockIcon />
              </div>
              <div className="premium-title">Too many attempts</div>
              <div className="premium-subtitle">This session is locked for security.</div>
            </div>
                        <div className="premium-info-strip pin-info-inline">
              <span className="info-strip-icon" aria-hidden="true"><LockIcon /></span>
                              <span>Contact the administrator to reset your access.</span>
                          </div>
            <button
              className="premium-btn-link"
              type="button"
              onClick={() => { window.location.href = "/senior-design-jury/"; }}
            >
              ←               Return to Home
            </button>
          </div>
        </div>
        {overlay}
      </>
    );
  }

  // ── Enter PIN ─────────────────────────────────────────────
  const overlay = <AuthOverlay open={authOverlay.open} />;
  const handleVerify = async (pin) => {
    if (authRef.current.active) return;
    if (pinStepRef.current === "locked") return;
    const baselineError = pinErrorRef.current;
    const seq = beginAuthOverlay();
    const started = stageStartRef.current || Date.now();
    try {
      await Promise.resolve(onPinSubmit(pin));
    } catch {}
    const elapsed = Date.now() - started;
    const wait = Math.max(0, 800 - elapsed);
    await new Promise((r) => setTimeout(r, wait));
    if (authRef.current.seq !== seq) return;
    if (pinStepRef.current === "entering" || pinStepRef.current === "locked") {
      closeAuthOverlay(seq);
      return;
    }
    if (pinErrorRef.current && pinErrorRef.current !== baselineError) {
      closeAuthOverlay(seq);
      return;
    }
    if (pinStepRef.current !== "entering") {
      setStage("verified", true);
      await new Promise((r) => setTimeout(r, 650));
      if (authRef.current.seq !== seq) return;
      // Do not show an extra loading stage here; fetchMyScores has its own loader.
    }
    closeAuthOverlay(seq);
  };
  return (
    <>
      <div className="premium-screen">
        <div className={`premium-card${shake ? " premium-card--shake" : ""}`}>
          <div className="premium-header">
            <div className="premium-icon-square" aria-hidden="true">
              <KeyRoundIcon />
            </div>
            <div className="premium-title">Enter your access PIN</div>
            <div className="premium-subtitle">Enter your 4-digit PIN to continue.</div>
          </div>
          {!pinError && (
            <div className="premium-helper">
              Attempts remaining: {attemptsLeftNum !== null
                ? `${attemptsLeftNum} ${attemptsLeftNum === 1 ? "attempt" : "attempts"}`
                : "…"}
            </div>
          )}
          {pinError && (
            <div className={`premium-error-banner${attemptsLeftNum !== null && attemptsLeftNum <= 1 ? " is-critical" : ""}`}>
<AlertCircleIcon />
              <div>
              <div className="premium-error-title">Incorrect PIN</div>
              <div className="premium-error-detail">
                {attemptsLeftNum !== null
                  ? `Please try again. ${attemptsLeftNum} ${attemptsLeftNum === 1 ? "attempt" : "attempts"} left.`
                  : "Please try again."}
</div>
              </div>
            </div>
          )}

          <PinBoxes onSubmit={handleVerify} pinError={pinError} shake={shake} />

        </div>
      </div>
      {overlay}
    </>
  );
}
