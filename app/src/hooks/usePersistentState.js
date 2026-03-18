import { useState, useEffect, useCallback } from "react";
import { lsGet, lsSet } from "../utils/storage.js";

// Persistent state that syncs to localStorage or window.storage.
// Starts loaded=true immediately from localStorage (synchronous),
// then async-hydrates from window.storage if available.
export function usePersistentState(key, fallback) {
  const loadInit = () => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw);
    } catch (_) {}
    return typeof fallback === "function" ? fallback() : fallback;
  };

  const [val, setValRaw] = useState(loadInit);

  useEffect(() => {
    // Best-effort hydration from window.storage (Claude artifact runner)
    lsGet(key).then(r => {
      if (r && r.value !== undefined) {
        try { setValRaw(JSON.parse(r.value)); } catch (_) {}
      }
    });
  }, [key]);

  const setVal = useCallback((updater) => {
    setValRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      lsSet(key, JSON.stringify(next));
      return next;
    });
  }, [key]);

  return [val, setVal];
}
