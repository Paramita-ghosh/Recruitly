import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck2, CalendarClock, CheckCircle2, Clock, Download, MapPin, Video } from 'lucide-react';
import { get, post, apiUrl, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Note, PageSkeleton, StatusBadge } from '../../components/ui';
import Logo from '../../components/layout/Logo';
import { Where } from '../../components/shared/InterviewList';
import { cn, fmtDateLong, fmtRange, fmtTime, label } from '../../lib/utils';


export default function Booking() {
  const { token } = useParams();
  const toast = useToast();
  const info = useAsync(() => get(`/bookings/${token}`), [token]);
  const [rescheduling, setRescheduling] = useState(false);
  const slots = useAsync(() => get(`/bookings/${token}/slots`), [token, info.data?.canBook, rescheduling], { skip: !info.data || !(info.data.canBook || rescheduling) });
  const [picked, setPicked] = useState(null);
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [day, setDay] = useState(0);

  const refreshAll = async () => { setPicked(null); setMode(null); setRescheduling(false); await info.reload({ silent: true }); };
  const book = async () => {
    setBusy(true); setError('');
    try {
      await post(`/bookings/${token}/${rescheduling ? 'reschedule' : 'confirm'}`, { startsAt: picked.start, mode: mode || picked.preferredMode || picked.modes[0] });
      toast.success(rescheduling ? 'Interview rescheduled' : 'Interview booked');
      await refreshAll();
    } catch (e) {
      setError(errMsg(e));
      if (e.response?.status === 409) { setPicked(null); slots.reload({ silent: true }); }
    } finally { setBusy(false); }
  };
  const accept = async () => {
    setBusy(true); setError('');
    try { await post(`/bookings/${token}/accept`); toast.success('Interview confirmed'); await refreshAll(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  const shell = (children) => (
    <div className="min-h-screen bg-app">
      <header className="border-b border-line bg-card"><div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5"><Logo /><Badge tone="gray">Secure booking link</Badge></div></header>
      <main className="mx-auto max-w-4xl animate-fadeUp px-5 py-8">{children}</main>
    </div>
  );
  if (info.loading && !info.data) return shell(<PageSkeleton />);
  if (info.error) return shell(<Card><ErrorState message={info.error.includes('valid') || info.error.includes('expired') ? info.error : `${info.error}`} /><p className="pb-6 text-center text-xs text-muted">If you believe this is a mistake, ask your placement coordinator for a new link.</p></Card>);
  const b = info.data;
  const tz = b.drive.timezone;
  const s = b.session;
  const days = slots.data?.days || [];
  const cur = days[Math.min(day, Math.max(0, days.length - 1))];

  return shell(
    <>
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{b.drive.company} · {b.drive.name}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Hi {b.candidate.name.split(' ')[0]}, let's book your {b.round.name}</h1>
        <p className="mt-2 text-sm text-muted">{b.round.durationMinutes} minutes · all times shown in {tz}</p>
      </div>

      <ol className="mb-6 flex flex-wrap gap-2">
        {b.progress.map((p) => (
          <li key={p.id} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold', p.id === b.round.id ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted')}>
            <span className="grid h-5 w-5 place-items-center rounded-full bg-soft text-[10px]">{p.position}</span>{p.name}
            <span className="font-normal opacity-80">{p.result ? label(p.result) : label(p.status)}</span>
          </li>
        ))}
      </ol>

      {error && <div className="mb-4 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm font-medium text-bad" role="alert">{error}</div>}

      {s && !rescheduling && (
        <Card className="mb-6" title={s.confirmed ? 'Your interview is confirmed' : 'Your interview has been scheduled'} action={<StatusBadge status={s.status} />}>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-ok/10 text-ok"><CheckCircle2 size={30} /></div>
              <div><p className="text-lg font-bold">{fmtDateLong(s.startsAt, tz)}</p><p className="text-sm text-muted">{fmtRange(s.startsAt, s.endsAt, tz)}</p></div>
            </div>
            <div className="space-y-1.5 text-sm">
              <p className="flex items-center gap-2 text-muted">{s.mode === 'online' ? <Video size={15} /> : <MapPin size={15} />}{label(s.mode)}</p>
              <Where s={s} />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {b.canConfirm && <Button icon={CheckCircle2} loading={busy} onClick={accept}>Confirm this time</Button>}
            {b.canReschedule && <Button variant="secondary" icon={CalendarClock} onClick={() => setRescheduling(true)}>Choose a different time</Button>}
            <a className="btn-secondary" href={apiUrl(`/bookings/${token}/ics`)} download><Download size={16} />Add to calendar (.ics)</a>
          </div>
          {!b.canReschedule && b.session.status === 'scheduled' && <p className="mt-3 text-xs text-muted">The reschedule window has closed. Contact your coordinator if you need a change.</p>}
        </Card>
      )}

      {(b.canBook || rescheduling) && (
        <Card title={rescheduling ? 'Pick a new time' : 'Choose a time that works for you'} subtitle="Only slots where a qualified interviewer and, for offline rounds, a room are genuinely free are shown."
          action={rescheduling ? <Button size="sm" variant="ghost" onClick={() => { setRescheduling(false); setPicked(null); }}>Cancel</Button> : null}>
          {slots.loading && !slots.data ? <div className="skeleton h-48" /> : slots.error ? <ErrorState message={slots.error} onRetry={slots.reload} /> : days.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No free slots right now" text="Every slot compatible with your availability is taken. Add more availability in your profile, or ask your coordinator to open more slots." />
          ) : (
            <>
              <div className="scroll-thin mb-4 flex gap-2 overflow-x-auto">
                {days.map((d, i) => <button key={d.date} onClick={() => { setDay(i); setPicked(null); }} className={cn('shrink-0 rounded-xl border px-4 py-2 text-left transition', i === day ? 'border-brand bg-brand text-white shadow' : 'border-line hover:bg-soft')}><p className="text-xs font-semibold opacity-80">{fmtDateLong(`${d.date}T12:00:00Z`, tz).split(',')[0]}</p><p className="text-sm font-bold">{d.date}</p><p className="text-[11px] opacity-80">{d.slots.length} slots</p></button>)}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {cur?.slots.map((sl) => (
                  <button key={sl.start} onClick={() => { setPicked(sl); setMode(sl.preferredMode || sl.modes[0]); setError(''); }}
                    className={cn('rounded-lg border px-3 py-2.5 text-sm font-semibold transition', picked?.start === sl.start ? 'border-brand bg-brand/10 text-brand ring-2 ring-brand/30' : 'border-line hover:border-brand hover:bg-soft')}>
                    <Clock size={13} className="mr-1 inline opacity-60" />{fmtTime(sl.start, tz)}
                  </button>
                ))}
              </div>
              {picked && (
                <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-brand/30 bg-brand/5 p-4">
                  <div className="flex-1"><p className="text-sm font-bold">{fmtDateLong(picked.start, tz)}, {fmtRange(picked.start, picked.end, tz)}</p>
                    {picked.modes.length > 1 ? (
                      <div className="mt-2 flex gap-2">{picked.modes.map((m) => <button key={m} onClick={() => setMode(m)} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', mode === m ? 'border-brand bg-brand text-white' : 'border-line bg-card')}>{label(m)}</button>)}</div>
                    ) : <p className="mt-1 text-xs text-muted">{label(picked.modes[0])} interview</p>}
                  </div>
                  <Button icon={CalendarCheck2} loading={busy} onClick={book}>{rescheduling ? 'Confirm new time' : 'Book this slot'}</Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {!s && !b.canBook && <Note tone="warn" title="Booking is not available">{b.deadlines.bookingOpen ? 'Self-booking is switched off for this drive. Your coordinator will schedule your interview and notify you.' : 'The booking deadline for this drive has passed. Please contact your coordinator.'}</Note>}
    </>,
  );
}
