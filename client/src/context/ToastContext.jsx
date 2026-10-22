import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';

const Ctx = createContext(null);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const remove = useCallback((id) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((kind, message) => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l.slice(-3), { id, kind, message }]);
    setTimeout(() => remove(id), kind === 'error' ? 7000 : 4000);
  }, [remove]);
  const api = { success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) };
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => {
          const I = Icon[t.kind];
          return (
            <div key={t.id} className={cn('pointer-events-auto flex animate-fadeUp items-start gap-3 rounded-xl border bg-card p-3 shadow-pop', t.kind === 'success' && 'border-ok/40', t.kind === 'error' && 'border-bad/40')}>
              <I size={18} className={cn('mt-0.5 shrink-0', t.kind === 'success' && 'text-ok', t.kind === 'error' && 'text-bad', t.kind === 'info' && 'text-brand')} />
              <p className="flex-1 text-sm text-ink">{t.message}</p>
              <button onClick={() => remove(t.id)} className="text-muted hover:text-ink" aria-label="Dismiss"><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
