import { useEffect, useState } from 'react';
import { Ban, CalendarClock, Check, RefreshCw, Users2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get, patch, post, errMsg } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Confirm, Field, Modal, Note, StatusBadge } from '../ui';
import { IcsLink, ModeBadge, Where } from './InterviewList';
import { dayKey, fmtDateLong, fmtRange, fmtTime, label, timeKey, zonedToIso } from '../../lib/utils';

export default function SessionModal({ session, onClose, onChanged, editable = true }) {
  const toast = useToast();
  const [mode, setMode] = useState('view'); // view | move
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [opts, setOpts] = useState(null);
  const [optIdx, setOptIdx] = useState(0);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [note, setNote] = useState('');
  const s = session;
  const tz = s?.timezone;

  useEffect(() => {
    if (!s) return;
    setMode('view'); setOpts(null); setError(''); setOptIdx(0); setNote('');
    setDate(dayKey(s.startsAt, tz));
    setTime(timeKey(s.startsAt, tz));
  }, [s?.id]); 
  if (!s) return null;
  const locked = !['scheduled'].includes(s.status) || s.resultStatus !== 'pending';

  const findOptions = async () => {
    setLoadingOpts(true); setError(''); setOpts(null);
    try {
      const startsAt = zonedToIso(date, time, tz);
      const list = await get(`/sessions/${s.id}/override-options`, { startsAt });
      setOpts(list); setOptIdx(0);
      if (!list.length) setError('No valid combination of interviewer, room and mode exists at that time. Hard constraints would be violated.');
    } catch (e) { setError(errMsg(e)); } finally { setLoadingOpts(false); }
  };
  const apply = async () => {
    const o = opts[optIdx];
    setBusy(true); setError('');
    try {
      await patch(`/sessions/${s.id}/override`, { startsAt: zonedToIso(date, time, tz), mode: o.mode, roomId: o.roomId || null, interviewerIds: o.interviewerIds, note: note || undefined });
      toast.success('Interview moved and everyone notified');
      onChanged?.(); onClose();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try { await post(`/sessions/${s.id}/cancel`, { reason: note || undefined }); toast.success('Interview cancelled'); setConfirmCancel(false); onChanged?.(); onClose(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true);
    try { const r = await post(`/interviews/${s.id}/calendar-sync`); toast.success(`Calendar status: ${label(r?.syncStatus || r?.status || 'updated')}`); onChanged?.(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <Modal open onClose={onClose} title={`${s.candidateName} · ${s.roundName}`} size="lg"
        footer={mode === 'view' ? (
          <>
            {editable && !locked && <Button variant="danger" icon={Ban} onClick={() => setConfirmCancel(true)}>Cancel interview</Button>}
            {editable && !locked && <Button icon={CalendarClock} onClick={() => setMode('move')}>Move / reassign</Button>}
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </>
        ) : <><Button variant="secondary" onClick={() => setMode('view')}>Back</Button><Button disabled={!opts?.length} loading={busy} icon={Check} onClick={apply}>Apply change</Button></>}>
        {mode === 'view' ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} /><ModeBadge mode={s.mode} />{s.source && <Badge tone="gray">{label(s.source)}</Badge>}{!s.published && <Badge tone="amber">Not published</Badge>}</div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="label">When</dt><dd className="text-sm font-semibold">{fmtDateLong(s.startsAt, tz)}</dd><dd className="text-sm text-muted">{fmtRange(s.startsAt, s.endsAt, tz)} ({tz})</dd></div>
              <div><dt className="label">Where</dt><dd><Where s={s} /></dd></div>
              <div><dt className="label">Candidate</dt><dd className="text-sm font-semibold">{s.candidateName}</dd><dd className="text-xs text-muted">{s.candidateEmail}</dd></div>
              <div><dt className="label">Panel</dt><dd className="flex items-center gap-1.5 text-sm"><Users2 size={14} className="text-muted" />{s.interviewers.map((i) => i.name).join(', ') || '—'}</dd></div>
              <div><dt className="label">Drive</dt><dd className="text-sm">{s.driveName}</dd></div>
              <div><dt className="label">Result</dt><dd className="text-sm">{s.resultStatus === 'pending' ? 'Pending' : label(s.resultStatus)}{s.finalScore != null && ` · score ${Math.round(s.finalScore)}`}</dd></div>
            </dl>
            {s.calendar && <Note tone={s.calendar.provider === 'google' ? 'ok' : 'warn'} title={`Calendar: ${s.calendar.provider === 'google' ? 'Google Calendar' : 'Demo (mock) provider'}`}>Sync status: <b>{label(s.calendar.syncStatus)}</b>{s.calendar.error ? ` – ${s.calendar.error}` : ''}.{s.calendar.provider !== 'google' && ' No external calendar event exists; Google Calendar is not connected.'}</Note>}
            <div className="flex flex-wrap gap-2">
              <IcsLink id={s.id}>Download .ics</IcsLink>
              {editable && <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy} onClick={sync}>Re-sync calendar</Button>}
              <Link className="btn-secondary btn-sm" to={`/coordinator/evaluations?session=${s.id}`}>Evaluations</Link>
            </div>
            {locked && editable && <p className="text-xs text-muted">This interview is {s.status === 'scheduled' ? 'already evaluated' : label(s.status)}, so it can no longer be moved.</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <Note tone="info">Pick a new date and time. Recruitly lists only combinations that satisfy every hard constraint (availability, skills, capacity, rooms, no overlaps). You cannot apply an invalid choice.</Note>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => { setDate(e.target.value); setOpts(null); }} /></Field>
              <Field label="Start time"><input type="time" className="input" step="900" value={time} onChange={(e) => { setTime(e.target.value); setOpts(null); }} /></Field>
              <div className="flex items-end"><Button variant="secondary" className="w-full" loading={loadingOpts} onClick={findOptions}>Find valid options</Button></div>
            </div>
            {error && <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
            {opts?.length > 0 && (
              <div className="space-y-2">
                <p className="label">Valid options at {fmtTime(zonedToIso(date, time, tz), tz)}</p>
                {opts.map((o, i) => (
                  <label key={i} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${i === optIdx ? 'border-brand bg-brand/5' : 'border-line'}`}>
                    <input type="radio" checked={i === optIdx} onChange={() => setOptIdx(i)} />
                    <ModeBadge mode={o.mode} /><span className="font-medium">{o.interviewers.map((x) => x.name).join(' + ')}</span>{o.roomName && <span className="text-muted">· {o.roomName}</span>}
                  </label>
                ))}
                <Field label="Note for the audit log (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
              </div>
            )}
          </div>
        )}
      </Modal>
      <Confirm open={confirmCancel} danger title="Cancel this interview?" confirmLabel="Cancel interview" loading={busy} onClose={() => setConfirmCancel(false)} onConfirm={cancel}
        text={`${s.candidateName} and the panel will be notified. The candidate returns to "needs rebooking" and can self-book again if the drive allows it.`} />
    </>
  );
}
