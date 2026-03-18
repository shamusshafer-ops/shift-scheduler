import { createContext, useContext, useState } from "react";
import { dark, light } from "../constants/themes.js";
import { lsGet, lsSet } from "../utils/storage.js";
import { useEffect } from "react";

export const ThemeContext = createContext(dark);
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
  const [theme, setThemeRaw] = useState(dark);

  useEffect(() => {
    lsGet("shift_theme").then(r => {
      if (r?.value === "light") setThemeRaw(light);
    });
  }, []);

  const setTheme = (t) => {
    setThemeRaw(t);
    lsSet("shift_theme", t.name);
  };

  const toggle = () => setTheme(theme.name === "dark" ? light : dark);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
