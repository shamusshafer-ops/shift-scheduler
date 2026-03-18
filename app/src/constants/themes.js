// ── Themes ────────────────────────────────────────────────────────────────────

export const dark = {
  name: "dark",
  bg: "#0f1117", surface: "#1a1d27", surfaceAlt: "#22262f",
  border: "#2d3241", text: "#e8eaf0", textMuted: "#8b90a0", textDim: "#5c6070",
  accent: "#4a9eff", supervisor: "#f0a030", guard: "#4a9eff",
  scale: "#50c878", medical: "#e05070", shiftFirst: "#fbbf24",
  shiftSecond: "#60a5fa", shiftThird: "#a78bfa", danger: "#ef4444",
  dangerDim: "#7f1d1d", warning: "#f59e0b", warningDim: "#78350f",
  fatigue: "#f97316", fatigueDim: "#7c2d12",
};

export const light = {
  name: "light",
  bg: "#f0f1f5", surface: "#ffffff", surfaceAlt: "#f7f8fa",
  border: "#d8dae0", text: "#1a1d27", textMuted: "#5c6070", textDim: "#8b90a0",
  accent: "#2a6fd6", supervisor: "#c47f10", guard: "#2a6fd6",
  scale: "#1a8a4a", medical: "#c03050", shiftFirst: "#b8860b",
  shiftSecond: "#2a6fd6", shiftThird: "#7c5cbf", danger: "#dc2626",
  dangerDim: "#fde8e8", warning: "#d97706", warningDim: "#fef3c7",
  fatigue: "#ea580c", fatigueDim: "#fff7ed",
};

// ── Color Helpers ─────────────────────────────────────────────────────────────
export const positionColor = (position, theme) =>
  ({ Supervisor: theme.supervisor, Guard: theme.guard, Scale: theme.scale, Medical: theme.medical }[position] || theme.textMuted);

export const shiftColor = (shiftId, theme) =>
  ({ first: theme.shiftFirst, second: theme.shiftSecond, third: theme.shiftThird }[shiftId] || theme.textMuted);
