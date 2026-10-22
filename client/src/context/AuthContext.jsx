import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, get, post } from '../lib/api';
import { disconnectSocket } from '../lib/socket';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export const HOME = { coordinator: '/coordinator', interviewer: '/interviewer', candidate: '/candidate', company: '/company' };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/auth/me');
      setUser(r.data.data.user);
    } catch { setUser(null); }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([refresh(), get('/auth/config').then(setConfig).catch(() => setConfig({}))]);
      setLoading(false);
    })();
    const onUnauthorized = () => setUser(null);
    window.addEventListener('recruitly:unauthorized', onUnauthorized);
    return () => window.removeEventListener('recruitly:unauthorized', onUnauthorized);
  }, [refresh]);

  const login = async (email, password) => {
    const d = await post('/auth/login', { email, password });
    setUser(d.user);
    return d.user;
  };
  const register = async (body) => {
    const d = await post('/auth/register', body);
    setUser(d.user);
    return d.user;
  };
  const logout = async () => {
    try { await post('/auth/logout'); } catch { }
    disconnectSocket();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, config, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}
