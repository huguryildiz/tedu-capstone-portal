// src/shared/LevelPill.jsx

function normalizeVariant(variant) {
  return String(variant || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export default function LevelPill({ variant, children, className = "" }) {
  const normalized = normalizeVariant(variant);
  const cls = `level-pill level-pill--${normalized}${className ? " " + className : ""}`;
  return <span className={cls}>{children}</span>;
}
