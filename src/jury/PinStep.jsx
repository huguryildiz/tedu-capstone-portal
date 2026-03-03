// src/jury/PinStep.jsx
// ============================================================
// PIN authentication screen.
// Jurors enter their 4-digit access code (juror_code from DB).
// No PIN creation — codes are managed by admin in the database.
//
// Props:
//   pinError    : string  — error message (empty = no error)
//   onPinSubmit : (pin: string) => void
//   onBack      : () => void
// ============================================================

import { useState, useRef, useEffect } from "react";
import { KeyRoundIcon, AlertCircleIcon } from "../shared/Icons";
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
    if (e.key === "Enter") {
      const pin = digits.join("");
      if (pin.length === 4) onSubmit(pin);
    }
  }

  function handlePaste(e) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (text.length === 4) {
      setDigits(text.split(""));
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

// ── Main component ────────────────────────────────────────────
export default function PinStep({ pinError, onPinSubmit, onBack }) {
  const [shake,       setShake]       = useState(false);
  const [authOverlay, setAuthOverlay] = useState(false);
  const authActiveRef = useRef(false);

  useEffect(() => {
    if (!pinError) return;
    setShake(false);
    const raf = requestAnimationFrame(() => setShake(true));
    const t   = setTimeout(() => setShake(false), 260);
    try { if (navigator?.vibrate) navigator.vibrate([60, 40, 60]); } catch {}
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [pinError]);

  const handleVerify = async (pin) => {
    if (authActiveRef.current) return;
    authActiveRef.current = true;
    setAuthOverlay(true);
    const start = Date.now();
    try {
      await Promise.resolve(onPinSubmit(pin));
    } catch {}
    const elapsed = Date.now() - start;
    const wait = Math.max(0, 800 - elapsed);
    await new Promise((r) => setTimeout(r, wait));
    authActiveRef.current = false;
    setAuthOverlay(false);
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

          {pinError && (
            <div className="premium-error-banner">
              <AlertCircleIcon />
              <div>
                <div className="premium-error-title">Incorrect PIN</div>
                <div className="premium-error-detail">{pinError}</div>
              </div>
            </div>
          )}

          <PinBoxes onSubmit={handleVerify} pinError={pinError} shake={shake} />

          {onBack && (
            <button className="premium-btn-link" type="button" onClick={onBack}
              style={{ marginTop: 16 }}>
              ← Back to Home
            </button>
          )}
        </div>
      </div>
      <MinimalLoaderOverlay open={authOverlay} minDuration={400} />
    </>
  );
}
