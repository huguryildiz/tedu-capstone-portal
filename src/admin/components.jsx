// src/admin/components.jsx
// ============================================================
// Shared JSX components for admin tab modules.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, HourglassIcon, PencilIcon, CircleIcon } from "../shared/Icons";
export { HomeIcon, RefreshIcon } from "../shared/Icons";
// ============================================================

// ── Outside click / tap (pointerdown) ────────────────────────
// Closes on pointerdown outside of provided target(s).
export function useOutsidePointerDown(isOpen, targets, onClose) {
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => {
      const list = Array.isArray(targets) ? targets : [targets];
      for (const t of list) {
        const el = t?.current ?? t;
        if (!el) continue;
        if (el === e.target || (el.contains && el.contains(e.target))) return;
      }
      onClose?.();
    };
    document.addEventListener("pointerdown", handle, { capture: true });
    return () => document.removeEventListener("pointerdown", handle, { capture: true });
  }, [isOpen, targets, onClose]);
}

// ── Filter popover portal ─────────────────────────────────────
// Renders a floating popover anchored to a button rect.
// mode="anchor" → positioned below the anchor element.
// mode="center" → fixed to viewport center (used by date range picker).
export function FilterPopoverPortal({ open, anchorRect, anchorEl, onClose, className, contentKey, mode = "anchor", children }) {
  const popRef = useRef(null);
  const [style, setStyle] = useState({ left: 0, top: 0, visibility: "hidden" });

  useOutsidePointerDown(open, [popRef, anchorEl], onClose);

  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const pop = popRef.current;
    const measureAndPlace = () => {
      if (mode === "center") {
        setStyle({ left: "50%", top: "50%", transform: "translate(-50%, -50%)", visibility: "visible" });
        return;
      }
      if (!anchorRect) return;
      const margin = 8;
      const popW = pop.offsetWidth;
      const popH = pop.offsetHeight;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      let left = anchorRect.left;
      left = Math.min(left, viewportW - popW - margin);
      left = Math.max(margin, left);
      let top = anchorRect.bottom + 6;
      if (top + popH + margin > viewportH) {
        const above = anchorRect.top - popH - 6;
        if (above >= margin) top = above;
        else top = Math.max(margin, viewportH - popH - margin);
      }
      setStyle({ left, top, transform: "none", visibility: "visible" });
    };
    measureAndPlace();
    window.addEventListener("resize", measureAndPlace);
    window.addEventListener("orientationchange", measureAndPlace);
    return () => {
      window.removeEventListener("resize", measureAndPlace);
      window.removeEventListener("orientationchange", measureAndPlace);
    };
  }, [open, anchorRect, contentKey, mode]);

  if (!open || (mode !== "center" && !anchorRect)) return null;

  return createPortal(
    <div
      ref={popRef}
      className={className}
      style={style}
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}

// ── Status badge ──────────────────────────────────────────────
// editingFlag = "editing" takes highest visual priority —
// it means the juror is actively re-editing a submitted form.
export function StatusBadge({ status, editingFlag, variant, icon, children }) {
  if (variant || icon || children) {
    return (
      <span className={`status-badge${variant ? ` ${variant}` : ""}`}>
        {icon}
        {children}
      </span>
    );
  }
  if (editingFlag === "editing")    return <span className="status-badge editing"><PencilIcon />Editing</span>;
  if (status === "all_submitted")   return <span className="status-badge submitted"><CheckIcon />Submitted</span>;
  if (status === "group_submitted") return <span className="status-badge submitted"><CheckIcon />Submitted</span>;
  if (status === "in_progress")     return <span className="status-badge in-progress"><HourglassIcon />In Progress</span>;
  return <span className="status-badge not-started"><CircleIcon />Not started</span>;
}
