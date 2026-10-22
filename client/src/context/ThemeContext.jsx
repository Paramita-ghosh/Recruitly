import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const Ctx = createContext(null);
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('recruitly-theme', theme); } catch { /* storage unavailable – theme still applies */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}
