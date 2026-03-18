// ── Storage Layer ─────────────────────────────────────────────────────────────
// Prefers window.storage (Claude artifact runner); falls back to localStorage.

const hasWinStorage = () =>
  typeof window !== "undefined" &&
  !!window.storage &&
  typeof window.storage.get === "function";

export const lsGet = (k) => {
  if (hasWinStorage()) return window.storage.get(k).catch(() => null);
  return Promise.resolve((() => {
    try {
      const v = localStorage.getItem(k);
      return v !== null ? { key: k, value: v } : null;
    } catch (_) { return null; }
  })());
};

export const lsSet = (k, v) => {
  if (hasWinStorage()) return window.storage.set(k, v).catch(() => null);
  return Promise.resolve((() => {
    try { localStorage.setItem(k, v); return { key: k, value: v }; }
    catch (_) { return null; }
  })());
};

export const lsDelete = (k) => {
  if (hasWinStorage()) return window.storage.delete(k).catch(() => null);
  return Promise.resolve((() => {
    try { localStorage.removeItem(k); return { key: k, deleted: true }; }
    catch (_) { return null; }
  })());
};

export const lsList = (pfx) => {
  if (hasWinStorage()) return window.storage.list(pfx).catch(() => ({ keys: [] }));
  return Promise.resolve((() => {
    try {
      return { keys: Object.keys(localStorage).filter(k => !pfx || k.startsWith(pfx)) };
    } catch (_) { return { keys: [] }; }
  })());
};

// ── Schema Migrations ─────────────────────────────────────────────────────────
const EMP_MIGRATIONS = {
  2: (emps) => emps.map(e => ({ notes: "", ...e })),
};

export async function runSchemaMigrations(schemaVersion) {
  const lsRead = async (key) => {
    try {
      if (hasWinStorage()) {
        const r = await window.storage.get(key);
        if (r && r.value !== undefined) return JSON.parse(r.value);
      } else {
        const v = localStorage.getItem(key);
        if (v !== null) return JSON.parse(v);
      }
    } catch (_) {}
    return undefined;
  };

  const lsWrite = async (key, val) => {
    try {
      if (hasWinStorage()) {
        await window.storage.set(key, JSON.stringify(val));
      } else {
        localStorage.setItem(key, JSON.stringify(val));
      }
    } catch (_) {}
  };

  const stored = await lsRead("shift_schema_version");
  const fromVer = typeof stored === "number" ? stored : 0;
  if (fromVer >= schemaVersion) return;

  console.log(`[Schema] Migrating from v${fromVer} to v${schemaVersion}`);

  const emps = await lsRead("shift_employees");
  if (Array.isArray(emps)) {
    let migrated = emps;
    for (let v = fromVer + 1; v <= schemaVersion; v++) {
      if (EMP_MIGRATIONS[v]) {
        migrated = EMP_MIGRATIONS[v](migrated);
        console.log(`[Schema] Employee migration v${v} applied`);
      }
    }
    await lsWrite("shift_employees", migrated);
  }

  await lsWrite("shift_schema_version", schemaVersion);
  console.log(`[Schema] Migration complete -> v${schemaVersion}`);
}
