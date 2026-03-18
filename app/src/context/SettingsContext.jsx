import { createContext, useContext } from "react";
import { DEFAULT_SETTINGS } from "../constants/index.js";
import { usePersistentState } from "../hooks/usePersistentState.js";

export const SettingsContext = createContext(DEFAULT_SETTINGS);
export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = usePersistentState("shift_settings", DEFAULT_SETTINGS);

  const update = (patch) => setSettings(prev => ({ ...prev, ...patch }));

  return (
    <SettingsContext.Provider value={{ settings, update }}>
      {children}
    </SettingsContext.Provider>
  );
}
