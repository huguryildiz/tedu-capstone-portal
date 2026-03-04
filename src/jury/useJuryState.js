// src/jury/useJuryState.js
// ============================================================
// Custom hook — owns ALL state and side-effects for the jury flow.
//
// ── Write strategy ────────────────────────────────────────────
//   writeGroup(pid): awaits rpc_upsert_score via Supabase.
//   Triggered by:
//     1. onBlur on any score input  → writeGroup(pid)
//     2. onBlur on comment textarea → writeGroup(pid)
//     3. Group navigation           → writeGroup(currentPid) then navigate
//
//   pendingScoresRef / pendingCommentsRef:
//     Updated synchronously in onChange handlers BEFORE React
//     commits state. writeGroup always reads from these refs so
//     it always sees the latest values regardless of render cycle.
//
// ── Identity ──────────────────────────────────────────────────
//   jurorId (UUID) comes from DB after PIN verification or
//   after issuing a new PIN (first-time juror).
//   juryName / juryDept are collected on the identity step.
//
// ── Step flow ─────────────────────────────────────────────────
//   "identity" → "semester" → ("pin" | "pin_reveal") → "eval" → "done"
//   (semester step auto-advances when exactly one active semester)
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { CRITERIA } from "../config";
import {
  listSemesters,
  getActiveSemester,
  listProjects,
  upsertScore,
  calcRowTotal,
  createOrGetJurorAndIssuePin,
  verifyJurorPin,
  getJurorEditState,
  finalizeJurorSubmission,
} from "../shared/api";

const STORAGE_KEYS = {
  jurorId: "jury.juror_id",
  semesterId: "jury.semester_id",
  jurorName: "jury.juror_name",
  jurorInst: "jury.juror_inst",
};
const MAX_PIN_ATTEMPTS = 5;

// ── Empty-state factories (project UUID keyed) ────────────────

const makeEmptyScores = (projects) =>
  Object.fromEntries(
    projects.map((p) => [
      p.project_id,
      Object.fromEntries(CRITERIA.map((c) => [c.id, null])),
    ])
  );

const makeEmptyComments = (projects) =>
  Object.fromEntries(projects.map((p) => [p.project_id, ""]));

const makeEmptyTouched = (projects) =>
  Object.fromEntries(
    projects.map((p) => [
      p.project_id,
      Object.fromEntries(CRITERIA.map((c) => [c.id, false])),
    ])
  );

const makeAllTouched = (projects) =>
  Object.fromEntries(
    projects.map((p) => [
      p.project_id,
      Object.fromEntries(CRITERIA.map((c) => [c.id, true])),
    ])
  );

// ── Pure helpers ──────────────────────────────────────────────

export const isScoreFilled = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v);
  const trimmed = String(v).trim();
  if (trimmed === "") return false;
  return Number.isFinite(Number(trimmed));
};

const isAllFilled = (scores, pid) =>
  CRITERIA.every((c) => isScoreFilled(scores[pid]?.[c.id]));

const isAllComplete = (scores, projects) =>
  projects.every((p) => isAllFilled(scores, p.project_id));

export const countFilled = (scores, projects) =>
  (projects || []).reduce(
    (t, p) =>
      t +
      CRITERIA.reduce(
        (n, c) => n + (isScoreFilled(scores[p.project_id]?.[c.id]) ? 1 : 0),
        0
      ),
    0
  );

const hasAnyCriteria = (scores, pid) =>
  CRITERIA.some((c) => isScoreFilled(scores[pid]?.[c.id]));

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export default function useJuryState() {

  // ── Identity (from DB after PIN login) ────────────────────
  const [jurorId,  setJurorId]  = useState("");
  const [juryName, setJuryName] = useState("");
  const [juryDept, setJuryDept] = useState("");

  // ── Semester ──────────────────────────────────────────────
  const [semesters,    setSemesters]    = useState([]);
  const [semesterId,   setSemesterId]   = useState("");
  const [semesterName, setSemesterName] = useState("");
  const [activeSemesterInfo, setActiveSemesterInfo] = useState(null);

  // ── Dynamic projects (from DB) ────────────────────────────
  // Shape: [{ project_id, group_no, project_title, group_students }]
  const [projects, setProjects] = useState([]);

  // ── Step / navigation ─────────────────────────────────────
  const [step,    setStep]    = useState("identity");
  const [current, setCurrent] = useState(0);

  // ── Scoring state ─────────────────────────────────────────
  const [scores,   setScores]   = useState({});
  const [comments, setComments] = useState({});
  const [touched,  setTouched]  = useState({});

  const [groupSynced, setGroupSynced] = useState({});
  const [editMode,    setEditMode]    = useState(false);
  const [editAllowed, setEditAllowed] = useState(false);
  const [editLockActive, setEditLockActive] = useState(false);

  const [doneScores,   setDoneScores]   = useState(null);
  const [doneComments, setDoneComments] = useState(null);

  // ── Loading / save state ──────────────────────────────────
  // null = idle; { stage: "loading"|"error", message: string }
  const [loadingState, setLoadingState] = useState(null);
  const [saveStatus,   setSaveStatus]   = useState("idle");

  // ── Auth state ────────────────────────────────────────────
  const [pinError, setPinError] = useState("");
  const [pinErrorCode, setPinErrorCode] = useState("");
  const [pinAttemptsLeft, setPinAttemptsLeft] = useState(MAX_PIN_ATTEMPTS);
  const [pinLockedUntil, setPinLockedUntil] = useState("");
  const [authError, setAuthError] = useState("");
  const [issuedPin, setIssuedPin] = useState("");

  // ── Submission confirmation ───────────────────────────────
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  // ── Refs ──────────────────────────────────────────────────
  const doneFiredRef     = useRef(false);
  const submitPendingRef = useRef(false);

  // stateRef: always-fresh snapshot for async callbacks
  const stateRef = useRef({});
  stateRef.current = { jurorId, semesterId, projects, scores, comments, current };

  // pendingScoresRef / pendingCommentsRef:
  // Updated synchronously in onChange handlers — writeGroup reads these
  // so it always has the latest values regardless of render timing.
  const pendingScoresRef   = useRef(scores);
  const pendingCommentsRef = useRef(comments);
  const lastWrittenRef     = useRef({});
  const semesterSelectLockRef = useRef(false);

  // ── Derived ───────────────────────────────────────────────
  const project     = projects[current] || null;
  const totalFields = projects.length * CRITERIA.length;
  const progressPct =
    totalFields > 0
      ? Math.round((countFilled(scores, projects) / totalFields) * 100)
      : 0;
  const allComplete = projects.length > 0 && isAllComplete(scores, projects);

  const clearLocalSession = useCallback(() => {
    try {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    } catch {}
  }, []);

  // ── Core write: single group → single score row ───────────
  // Reads from pendingScoresRef / pendingCommentsRef — always fresh.
  const writeGroup = useCallback(
    async (pid) => {
      const { jurorId: jid, semesterId: sid } = stateRef.current;
      if (!jid || !sid || !pid) return;

      const s = pendingScoresRef.current;
      const c = pendingCommentsRef.current;
      const currentComment = String(c[pid] || "");

      if (!hasAnyCriteria(s, pid) && currentComment === "" && !lastWrittenRef.current[pid]) {
        return; // truly untouched, skip
      }

      const total = calcRowTotal(s, pid);
      const last  = lastWrittenRef.current[pid];
      if (
        last &&
        last.comment === currentComment &&
        last.total === total
      ) {
        return; // no data changes
      }

      setSaveStatus("saving");
      try {
        await upsertScore(sid, pid, jid, s[pid] || {}, currentComment);
        lastWrittenRef.current[pid] = { total, comment: currentComment };
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);

        if (isAllFilled(s, pid)) {
          setGroupSynced((prev) => ({ ...prev, [pid]: true }));
        }
      } catch (_) {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [] // stateRef and refs are stable
  );

  // ── Group navigation with guaranteed write ────────────────
  const handleNavigate = useCallback(
    async (newIndex) => {
      const { current: cur, projects: projs } = stateRef.current;
      const currentPid = projs[cur]?.project_id;
      if (currentPid) await writeGroup(currentPid);
      setCurrent(newIndex);
    },
    [writeGroup]
  );

  // ── Auto-upgrade groupSynced ──────────────────────────────
  useEffect(() => {
    if (step !== "eval" || editMode) return;
    const newly = {};
    projects.forEach((p) => {
      if (!groupSynced[p.project_id] && isAllFilled(scores, p.project_id)) {
        newly[p.project_id] = true;
      }
    });
    if (Object.keys(newly).length > 0) {
      setGroupSynced((prev) => ({ ...prev, ...newly }));
    }
  }, [scores, step, groupSynced, editMode, projects]);

  // ── Auto-done: show confirmation when all groups filled ───
  useEffect(() => {
    if (step !== "eval" || doneFiredRef.current || editMode) return;
    if (submitPendingRef.current) return;
    if (projects.length === 0) return;
    if (!projects.every((p) => groupSynced[p.project_id])) return;

    submitPendingRef.current = true;
    setConfirmingSubmit(true);
  }, [groupSynced, step, editMode, projects]);

  // ── Score handlers ────────────────────────────────────────

  const handleScore = useCallback(
    (pid, cid, val) => {
      const stored = val === "" ? null : val;
      const newScores = {
        ...pendingScoresRef.current,
        [pid]: { ...pendingScoresRef.current[pid], [cid]: stored },
      };
      pendingScoresRef.current = newScores;
      setScores(newScores);
      setTouched((prev) => ({ ...prev, [pid]: { ...prev[pid], [cid]: true } }));
      if (!isScoreFilled(stored)) {
        setGroupSynced((prev) => ({ ...prev, [pid]: false }));
      }
    },
    []
  );

  const handleScoreBlur = useCallback(
    (pid, cid) => {
      const crit = CRITERIA.find((c) => c.id === cid);
      setTouched((prev) => ({ ...prev, [pid]: { ...prev[pid], [cid]: true } }));
      // Clamp and normalize value
      const val       = pendingScoresRef.current[pid]?.[cid];
      let normalized;
      if (val === "" || val === null || val === undefined) {
        normalized = null;
      } else {
        const n = parseInt(String(val), 10);
        normalized = Number.isFinite(n)
          ? Math.min(Math.max(n, 0), crit.max)
          : null;
      }
      const newScores = {
        ...pendingScoresRef.current,
        [pid]: { ...pendingScoresRef.current[pid], [cid]: normalized },
      };
      pendingScoresRef.current = newScores;
      setScores(newScores);
      writeGroup(pid);
    },
    [writeGroup]
  );

  const handleCommentChange = useCallback((pid, val) => {
    pendingCommentsRef.current = { ...pendingCommentsRef.current, [pid]: val };
    setComments((prev) => ({ ...prev, [pid]: val }));
  }, []);

  const handleCommentBlur = useCallback(
    (pid) => {
      writeGroup(pid);
    },
    [writeGroup]
  );

  // ── Submit handlers ───────────────────────────────────────

  const handleRequestSubmit = useCallback(() => {
    const { scores: s, projects: projs } = stateRef.current;
    if (!isAllComplete(s, projs)) {
      setTouched(makeAllTouched(projs));
      const firstIncomplete = projs.findIndex(
        (p) => !isAllFilled(s, p.project_id)
      );
      if (firstIncomplete >= 0) setCurrent(firstIncomplete);
      return;
    }
    submitPendingRef.current = true;
    setConfirmingSubmit(true);
  }, []);

  const handleConfirmSubmit = useCallback(() => {
    setConfirmingSubmit(false);
    submitPendingRef.current = false;
    doneFiredRef.current = true;
    const { scores: s, comments: c, jurorId: jid, semesterId: sid } = stateRef.current;
    setDoneScores({ ...s });
    setDoneComments({ ...c });
    setEditMode(false);
    setStep("done");

    if (editMode && jid && sid) {
      finalizeJurorSubmission(sid, jid)
        .then(() => {
          setEditAllowed(false);
          setEditExpiresAt("");
        })
        .catch(() => {});
    }
  }, [editMode]);

  const handleCancelSubmit = useCallback(() => {
    setConfirmingSubmit(false);
    submitPendingRef.current = false;
  }, []);

  // ── Edit-mode from DoneStep ───────────────────────────────
  const handleEditScores = useCallback(() => {
    if (!editAllowed) return;
    const s = doneScores || scores;
    const c = doneComments || comments;
    pendingScoresRef.current   = s;
    pendingCommentsRef.current = c;
    setScores(s);
    setComments(c);
    setEditMode(true);
    doneFiredRef.current = false;
    setGroupSynced(
      Object.fromEntries(projects.map((p) => [p.project_id, true]))
    );
    setStep("eval");
  }, [editAllowed, doneScores, doneComments, scores, comments, projects]);

  // ── Identity submit (name + institution) ──────────────────
  const handleIdentitySubmit = useCallback(async () => {
    const name = juryName.trim();
    const inst = juryDept.trim();
    if (!name || !inst) {
      setAuthError("Please enter your full name and institution.");
      return;
    }
    setAuthError("");
    setLoadingState({ stage: "loading", message: "Loading semesters…" });
    try {
      const semesterList = await listSemesters();
      setSemesters((semesterList || []).filter((s) => s.is_active));
      setLoadingState(null);
      setStep("semester");
    } catch (_) {
      setLoadingState(null);
      setAuthError("Could not load semesters. Please try again.");
    }
  }, [juryName, juryDept]);

  useEffect(() => {
    let alive = true;
    getActiveSemester()
      .then((res) => {
        if (alive) setActiveSemesterInfo(res || null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // ── PIN submit (resume) ───────────────────────────────────
  const handlePinSubmit = useCallback(async (enteredPin) => {
    setPinError("");
    setPinErrorCode("");
    setPinLockedUntil("");
    setLoadingState({ stage: "loading", message: "Verifying…" });
    try {
      const res = await verifyJurorPin(semesterId, juryName, juryDept, enteredPin);
      if (!res?.ok) {
        setLoadingState(null);
        const failedAttempts =
          typeof res?.failed_attempts === "number" ? res.failed_attempts : null;
        if (res?.error_code === "locked") {
          setPinErrorCode("locked");
          setPinAttemptsLeft(0);
          setPinLockedUntil(res?.locked_until || "");
          setPinError("locked");
        } else if (res?.error_code === "semester_inactive") {
          setPinErrorCode("semester_inactive");
          setPinAttemptsLeft(MAX_PIN_ATTEMPTS);
          setPinError("This semester is no longer active. Please start a new evaluation.");
        } else if (res?.error_code === "not_found") {
          setPinErrorCode("not_found");
          setPinAttemptsLeft(MAX_PIN_ATTEMPTS);
          setPinError("No juror found with this name/institution.");
        } else if (res?.error_code === "no_pin") {
          setPinErrorCode("no_pin");
          setPinAttemptsLeft(MAX_PIN_ATTEMPTS);
          setPinError("No PIN found for this semester. Please start a new evaluation.");
        } else {
          setPinErrorCode("invalid");
          if (failedAttempts !== null) {
            setPinAttemptsLeft(Math.max(0, MAX_PIN_ATTEMPTS - failedAttempts));
          }
          setPinError("Incorrect PIN.");
        }
        return;
      }
      const jid = res.juror_id;
      const nextName = res.juror_name || juryName;
      const nextInst = res.juror_inst || juryDept;
      if (res.juror_name) setJuryName(res.juror_name);
      if (res.juror_inst) setJuryDept(res.juror_inst);
      setJurorId(jid);
      setPinAttemptsLeft(MAX_PIN_ATTEMPTS);
      setPinLockedUntil("");
      setLoadingState(null);
      await _loadSemester({ id: semesterId, name: semesterName }, jid, { name: nextName, inst: nextInst });
    } catch (_) {
      setLoadingState(null);
      setPinAttemptsLeft(MAX_PIN_ATTEMPTS);
      setPinErrorCode("network");
      setPinLockedUntil("");
      setPinError("Connection error. Please try again.");
    }
  }, [semesterId, semesterName, juryName, juryDept]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Internal: load semester + projects ───────────────────
  // Shared by handlePinSubmit (auto-advance) and handleSemesterSelect.
  const _loadSemester = async (semester, overrideJurorId, identityOverride) => {
    const jid = overrideJurorId || stateRef.current.jurorId;
    setLoadingState({ stage: "loading", message: "Loading projects…" });
    try {
      const projectList = await listProjects(semester.id, jid);
      let editState = null;
      try {
        editState = await getJurorEditState(semester.id, jid);
      } catch {}

      setSemesterId(semester.id);
      setSemesterName(semester.name);

      // Seed scores / comments from existing DB data
      const seedScores   = Object.fromEntries(
        projectList.map((p) => [p.project_id, { ...p.scores }])
      );
      const seedComments = Object.fromEntries(
        projectList.map((p) => [p.project_id, p.comment || ""])
      );
      const seedTouched  = makeEmptyTouched(projectList);
      // A project is already "synced" if the juror has previously submitted all criteria
      const seedSynced   = Object.fromEntries(
        projectList
          .filter((p) => p.submitted_at !== null)
          .map((p) => [p.project_id, true])
      );

      // Strip to just the fields the UI needs (scores live in state separately)
      const uiProjects = projectList.map((p) => ({
        project_id:     p.project_id,
        group_no:       p.group_no,
        project_title:  p.project_title,
        group_students: p.group_students,
      }));

      pendingScoresRef.current   = seedScores;
      pendingCommentsRef.current = seedComments;
      lastWrittenRef.current     = {};

      setProjects(uiProjects);
      setScores(seedScores);
      setComments(seedComments);
      setTouched(seedTouched);
      setGroupSynced(seedSynced);
      setCurrent(0);
      doneFiredRef.current = false;
      submitPendingRef.current = false;
      setLoadingState(null);
      const canEdit = !!editState?.edit_allowed;
      setEditAllowed(canEdit);
      setEditLockActive(!!editState?.lock_active);
      const allCompleteNow = uiProjects.length > 0 && isAllComplete(seedScores, uiProjects);
      if (allCompleteNow) {
        setDoneScores({ ...seedScores });
        setDoneComments({ ...seedComments });
        setEditMode(false);
        setStep("done");
      } else {
        setDoneScores(null);
        setDoneComments(null);
        setStep("eval");
      }
    } catch (_) {
      setLoadingState(null);
      setPinError("Could not load projects. Please try again.");
      setStep("identity");
    }
  };

  // ── Semester selection (from SemesterStep) ────────────────
  const handleSemesterSelect = useCallback(
    async (semester) => {
      if (semesterSelectLockRef.current) return;
      if (!semester?.is_active) {
        setAuthError("Only the active semester can be evaluated.");
        setStep("identity");
        return;
      }
      const name = juryName.trim();
      const inst = juryDept.trim();
      if (!name || !inst) {
        setAuthError("Please enter your full name and institution.");
        setStep("identity");
        return;
      }
      semesterSelectLockRef.current = true;
      setAuthError("");
      setSemesterId(semester.id);
      setSemesterName(semester.name);
      setLoadingState({ stage: "loading", message: "Preparing access…" });
      try {
        const res = await createOrGetJurorAndIssuePin(semester.id, name, inst);
        if (res?.juror_name) setJuryName(res.juror_name);
        if (res?.juror_inst) setJuryDept(res.juror_inst);
        if (res?.needs_pin) {
          setJurorId(res.juror_id || "");
          setIssuedPin("");
          setPinError("");
          const lockedUntil = res?.locked_until || "";
          const lockedDate = lockedUntil ? new Date(lockedUntil) : null;
          const isLocked = lockedDate && !Number.isNaN(lockedDate.getTime()) && lockedDate > new Date();
          if (isLocked) {
            setPinErrorCode("locked");
            setPinAttemptsLeft(0);
            setPinLockedUntil(lockedUntil);
          } else {
            setPinErrorCode("");
            setPinAttemptsLeft(MAX_PIN_ATTEMPTS);
            setPinLockedUntil("");
          }
          setLoadingState(null);
          setStep("pin");
          return;
        }
        setJurorId(res?.juror_id || "");
        setIssuedPin(res?.pin_plain_once || "");
        setPinError("");
        setPinErrorCode("");
        setPinAttemptsLeft(MAX_PIN_ATTEMPTS);
        setPinLockedUntil("");
        setLoadingState(null);
        setStep("pin_reveal");
      } catch (e) {
        semesterSelectLockRef.current = false;
        setLoadingState(null);
        if (String(e?.message || "").includes("semester_inactive")) {
          setAuthError("This semester is no longer active. Please try again.");
        } else {
          setAuthError("Could not start the evaluation. Please try again.");
        }
        setStep("identity");
      }
    },
    [juryName, juryDept]
  );

  const handlePinRevealContinue = useCallback(async () => {
    if (!jurorId || !semesterId) return;
    setIssuedPin("");
    await _loadSemester({ id: semesterId, name: semesterName }, jurorId, { name: juryName, inst: juryDept });
  }, [jurorId, semesterId, semesterName, juryName, juryDept]);

  // NOTE: We intentionally do NOT auto-resume. PIN is always required on entry.

  // ── Full reset ────────────────────────────────────────────
  const resetAll = useCallback(() => {
    setJurorId("");
    setJuryName("");
    setJuryDept("");
    setSemesters([]);
    setSemesterId("");
    setSemesterName("");
    setProjects([]);
    setStep("identity");
    setCurrent(0);
    setScores({});
    setComments({});
    setTouched({});
    setGroupSynced({});
    setEditMode(false);
    setEditAllowed(false);
    setEditLockActive(false);
    setDoneScores(null);
    setDoneComments(null);
    setLoadingState(null);
    setSaveStatus("idle");
    setPinError("");
    setPinErrorCode("");
    setPinAttemptsLeft(MAX_PIN_ATTEMPTS);
    setPinLockedUntil("");
    setAuthError("");
    setIssuedPin("");
    setConfirmingSubmit(false);
    pendingScoresRef.current   = {};
    pendingCommentsRef.current = {};
    lastWrittenRef.current     = {};
    semesterSelectLockRef.current = false;
    doneFiredRef.current       = false;
    submitPendingRef.current   = false;
  }, []);

  // ─────────────────────────────────────────────────────────
  return {
    // Identity
    jurorId,
    juryName, setJuryName,
    juryDept, setJuryDept,
    authError,
    issuedPin,

    // Semester
    semesters,
    semesterId,
    semesterName,
    activeSemesterInfo,

    // Projects (dynamic)
    projects,

    // Step / navigation
    step, setStep,
    current,
    handleNavigate,

    // Scoring
    scores, comments, touched,
    handleScore, handleScoreBlur,
    handleCommentChange, handleCommentBlur,

    // Derived
    project, progressPct, allComplete,
    groupSynced, editMode, editAllowed, editLockActive,
    doneScores, doneComments,

    // Loading
    loadingState,
    saveStatus,

    // PIN
    pinError,
    pinErrorCode,
    pinAttemptsLeft,
    pinLockedUntil,
    handlePinSubmit,
    handleIdentitySubmit,
    handlePinRevealContinue,

    // Semester
    handleSemesterSelect,

    // Submit
    confirmingSubmit,
    handleRequestSubmit,
    handleConfirmSubmit,
    handleCancelSubmit,

    // Edit
    handleEditScores,
    handleFinalSubmit: handleRequestSubmit,

    resetAll,
    clearLocalSession,
  };
}
