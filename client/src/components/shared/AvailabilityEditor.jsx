import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eraser, Save, Trash2, Plus, Star, CheckSquare } from 'lucide-react';
import { del, get, post, put, errMsg } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Button, Card, Field, ErrorState, SkeletonRows, Badge, EmptyState } from '../ui';
import { cn, WEEKDAYS, dateOnly } from '../../lib/utils';

const START = 7 * 60;
const END = 21 * 60;
const STEP = 30;
const ROWS = Array.from({ length: (END - START) / STEP }, (_, i) => START + i * STEP);
const DAYS = [1, 2, 3, 4, 5, 6, 0]; 
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const key = (d, m) => `${d}|${m}`;

function rulesToCells(rules) {
  const cells = {};
  for (const r of rules) {
    if (!['available', 'preferred'].includes(r.kind)) continue;
    for (let m = Math.max(START, toMin(r.startTime)); m < Math.min(END, toMin(r.endTime)); m += STEP) {
      if (cells[key(r.weekday, m)] !== 'preferred') cells[key(r.weekday, m)] = r.kind;
    }
  }
  return cells;
}
function cellsToRules(cells) {
  const out = [];
  for (const d of DAYS) {
    let run = null;
    for (const m of [...ROWS, END]) {
      const v = m < END ? cells[key(d, m)] : undefined;
      if (run && v !== run.kind) { out.push({ weekday: d, startTime: hhmm(run.start), endTime: hhmm(m), kind: run.kind }); run = null; }
      if (!run && v) run = { start: m, kind: v };
    }
  }
  return out;
}

export default function AvailabilityEditor({ userId, allowPreferred = false, title = 'Weekly availability' }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, error: null });
  const [cells, setCells] = useState({});
  const [exceptions, setExceptions] = useState([]);
  const [tool, setTool] = useState('available');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const painting = useRef(null);
  const qs = userId ? { userId } : undefined;

  const load = useCallback(async () => {
    setState({ loading: true, error: null });
    try {
      const d = await get('/availability', qs);
      setCells(rulesToCells(d.rules));
      setExceptions(d.exceptions);
      setDirty(false);
      setState({ loading: false, error: null });
    } catch (e) { setState({ loading: false, error: errMsg(e) }); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const up = () => { painting.current = null; }; window.addEventListener('pointerup', up); return () => window.removeEventListener('pointerup', up); }, []);

  const apply = (d, m) => {
    const k = key(d, m);
    setCells((c) => {
      const n = { ...c };
      if (painting.current === 'erase') delete n[k]; else n[k] = painting.current;
      return n;
    });
    setDirty(true);
  };
  const down = (d, m) => (e) => {
    e.preventDefault();
    const cur = cells[key(d, m)];
    painting.current = tool === 'erase' || cur === tool ? 'erase' : tool;
    apply(d, m);
  };
  const enter = (d, m) => () => { if (painting.current) apply(d, m); };
  const fillDay = (d) => { setCells((c) => { const n = { ...c }; for (let m = 9 * 60; m < 17 * 60; m += STEP) n[key(d, m)] = tool === 'preferred' ? 'preferred' : 'available'; return n; }); setDirty(true); };
  const clearDay = (d) => { setCells((c) => { const n = { ...c }; for (const m of ROWS) delete n[key(d, m)]; return n; }); setDirty(true); };

  const total = useMemo(() => Object.keys(cells).length * STEP / 60, [cells]);
  const save = async () => {
    setSaving(true);
    try {
      await put('/availability', { ...(userId ? { userId } : {}), rules: cellsToRules(cells) });
      toast.success('Availability saved');
      await load();
    } catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  };

  const [ex, setEx] = useState({ date: '', whole: true, startTime: '10:00', endTime: '12:00', kind: 'unavailable', reason: '' });
  const addEx = async (e) => {
    e.preventDefault();
    if (!ex.date) return toast.error('Pick a date first');
    try {
      await post('/availability/exceptions', { ...(userId ? { userId } : {}), date: ex.date, kind: ex.kind, reason: ex.reason || undefined, ...(ex.whole ? {} : { startTime: ex.startTime, endTime: ex.endTime }) });
      toast.success('Exception added');
      setEx({ ...ex, date: '', reason: '' });
      const d = await get('/availability', qs); setExceptions(d.exceptions);
    } catch (er) { toast.error(errMsg(er)); }
  };
  const rmEx = async (id) => { try { await del(`/availability/exceptions/${id}`); setExceptions((l) => l.filter((x) => x.id !== id)); } catch (e) { toast.error(errMsg(e)); } };

  if (state.loading) return <Card><SkeletonRows rows={8} /></Card>;
  if (state.error) return <Card><ErrorState message={state.error} onRetry={load} /></Card>;

  const tools = [
    { id: 'available', label: 'Available', icon: CheckSquare, cls: 'bg-teal text-white' },
    ...(allowPreferred ? [{ id: 'preferred', label: 'Preferred', icon: Star, cls: 'bg-violet text-white' }] : []),
    { id: 'erase', label: 'Erase', icon: Eraser, cls: 'bg-muted text-white' },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card title={title} subtitle="Click or drag across the grid to paint time blocks. Times are in the drive's time zone."
        action={<div className="flex items-center gap-2"><Badge tone="blue">{total} h selected</Badge><Button size="sm" icon={Save} loading={saving} disabled={!dirty} onClick={save}>Save changes</Button></div>}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tools.map((t) => (
            <button key={t.id} onClick={() => setTool(t.id)} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition', tool === t.id ? `${t.cls} border-transparent shadow-sm` : 'border-line bg-card text-muted hover:bg-soft')}>
              <t.icon size={14} />{t.label}
            </button>
          ))}
          <span className="ml-auto hidden text-xs text-muted sm:block">Tip: click a day name to fill 09:00–17:00</span>
        </div>
        <div className="scroll-thin select-none overflow-x-auto" onPointerLeave={() => { painting.current = null; }}>
          <div className="grid min-w-[640px]" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
            <div />
            {DAYS.map((d) => (
              <div key={d} className="px-1 pb-2 text-center">
                <button onClick={() => fillDay(d)} className="text-xs font-bold text-ink hover:text-brand" title={`Fill ${WEEKDAYS[d]}`}>{WEEKDAYS[d].slice(0, 3)}</button>
                <button onClick={() => clearDay(d)} className="ml-1 align-middle text-muted/60 hover:text-bad" title={`Clear ${WEEKDAYS[d]}`}><Trash2 size={11} /></button>
              </div>
            ))}
            {ROWS.map((m) => (
              <div key={m} className="contents">
                <div className="-mt-2 pr-2 text-right text-[10px] font-medium leading-none text-muted">{m % 60 === 0 ? hhmm(m) : ''}</div>
                {DAYS.map((d) => {
                  const v = cells[key(d, m)];
                  return (
                    <div key={d} onPointerDown={down(d, m)} onPointerEnter={enter(d, m)} role="gridcell" aria-label={`${WEEKDAYS[d]} ${hhmm(m)} ${v || 'unavailable'}`}
                      className={cn('h-5 cursor-pointer border-b border-r border-line/70 transition-colors', m % 60 === 0 && 'border-t border-t-line',
                        v === 'available' && 'bg-teal/75', v === 'preferred' && 'bg-violet/80', !v && 'hover:bg-brand/10')} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-teal/75" />Available</span>
          {allowPreferred && <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-violet/80" />Preferred (scheduler tries these first)</span>}
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-line" />Unavailable</span>
        </div>
      </Card>

      <Card title="Date exceptions" subtitle="One-off changes. “Unavailable” always wins over the weekly pattern.">
        <form onSubmit={addEx} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" className="input" value={ex.date} onChange={(e) => setEx({ ...ex, date: e.target.value })} /></Field>
            <Field label="Type"><select className="input" value={ex.kind} onChange={(e) => setEx({ ...ex, kind: e.target.value })}><option value="unavailable">Unavailable</option><option value="available">Extra availability</option></select></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ex.whole} onChange={(e) => setEx({ ...ex, whole: e.target.checked })} />Whole day</label>
          {!ex.whole && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><input type="time" className="input" value={ex.startTime} onChange={(e) => setEx({ ...ex, startTime: e.target.value })} /></Field>
              <Field label="To"><input type="time" className="input" value={ex.endTime} onChange={(e) => setEx({ ...ex, endTime: e.target.value })} /></Field>
            </div>
          )}
          <Field label="Reason (optional)"><input className="input" value={ex.reason} maxLength={200} onChange={(e) => setEx({ ...ex, reason: e.target.value })} placeholder="e.g. Exam, travel" /></Field>
          <Button type="submit" variant="secondary" icon={Plus} className="w-full">Add exception</Button>
        </form>
        <div className="mt-5 space-y-2">
          {exceptions.length === 0 && <EmptyState title="No exceptions" text="Your weekly pattern applies every week." />}
          {exceptions.map((x) => (
            <div key={x.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{dateOnly(x.date)} <span className="font-normal text-muted">{x.startTime ? `${x.startTime}–${x.endTime}` : 'whole day'}</span></p>
                <p className="truncate text-xs text-muted">{x.reason || '—'}</p>
              </div>
              <Badge tone={x.kind === 'unavailable' ? 'red' : 'green'}>{x.kind}</Badge>
              <button onClick={() => rmEx(x.id)} className="text-muted hover:text-bad" aria-label="Remove exception"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
