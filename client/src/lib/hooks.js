import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from './api';

export function useAsync(fn, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ data: null, loading: !skip, error: null });
  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback(async ({ silent = false } = {}) => {
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (alive.current && id === seq.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (alive.current && id === seq.current) setState((s) => ({ data: silent ? s.data : null, loading: false, error: errMsg(e) }));
    }
  }, deps); 
  useEffect(() => { if (!skip) run(); else setState({ data: null, loading: false, error: null }); }, [run, skip]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
