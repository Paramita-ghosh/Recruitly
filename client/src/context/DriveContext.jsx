import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { useAuth } from './AuthContext';

const Ctx = createContext(null);
export const useDrive = () => useContext(Ctx);

/** Staff (coordinator / company) work inside one "current drive" at a time; the choice is remembered. */
export function DriveProvider({ children }) {
  const { user } = useAuth();
  const [drives, setDrives] = useState([]);
  const [driveId, setDriveId] = useState(() => { try { return localStorage.getItem('recruitly-drive') || ''; } catch { return ''; } });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const reload = useCallback(async () => {
    if (!user || !['coordinator', 'company'].includes(user.role)) { setLoading(false); return; }
    try {
      const list = await get('/drives');
      setDrives(list);
      setDriveId((cur) => (list.some((d) => d.id === cur) ? cur : list[0]?.id || ''));
    } finally { setLoading(false); }
  }, [user]);

  const reloadDetail = useCallback(async () => {
    if (!driveId) { setDetail(null); return; }
    try { setDetail(await get(`/drives/${driveId}`)); } catch { setDetail(null); }
  }, [driveId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { reloadDetail(); }, [reloadDetail]);
  useEffect(() => { try { if (driveId) localStorage.setItem('recruitly-drive', driveId); } catch { /* ignore */ } }, [driveId]);

  const value = useMemo(() => ({ drives, driveId, setDriveId, drive: detail, loading, reload, reloadDetail, rounds: detail?.rounds || [] }), [drives, driveId, detail, loading, reload, reloadDetail]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
