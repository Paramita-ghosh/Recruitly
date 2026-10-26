import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Eye, RefreshCcw, ShieldAlert, X } from 'lucide-react';
import { get, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Async, Badge, Button, Card, Confirm, EmptyState, Field, Modal, Note, PageHeader, Stat, StatusBadge, Table } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import { fmtDateTime, fmtTime, label, zonedToIso, dateOnly } from '../../lib/utils';

const TYPE = { interviewer_substituted: ['green', 'Interviewer substituted'], moved: ['blue', 'Moved'], moved_for_capacity: ['violet', 'Moved to free capacity'], needs_rebooking: ['amber', 'Needs rebooking'], manual_review: ['red', 'Manual review'] };

function Side({ s, tz }) {
  if (!s) return <span className="text-muted">—</span>;
  return <div className="text-xs"><p className="font-semibold">{fmtDateTime(s.startsAt, tz)}</p><p className="text-muted">{label(s.mode)}{s.roomName ? ` · ${s.roomName}` : ''}</p><p className="text-muted">{s.interviewers.map((i) => i.name).join(', ')}</p></div>;
}

export function RunDetail({ driveId, runId, tz, onChanged }) {
  const toast = useToast();
  const st = useAsync(() => get(`/drives/${driveId}/reschedules/${runId}`), [driveId, runId]);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  const act = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'approve') { await post(`/drives/${driveId}/reschedules/${runId}/approve`); toast.success('Reschedule applied. Affected people were notified.'); }
      else { await post(`/drives/${driveId}/reschedules/${runId}/discard`); toast.info('Plan discarded. Nothing was changed.'); }
      setConfirm(false); await st.reload({ silent: true }); onChanged?.();
    } catch (e) { toast.error(errMsg(e)); setConfirm(false); if (e.response?.status === 409) st.reload({ silent: true }); } finally { setBusy(''); }
  };
  return (
    <Async state={st}>
      {(r) => (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3"><StatusBadge status={r.status} /><span className="text-sm text-muted">Cancelled availability of <b className="text-ink">{r.interviewer.name}</b>: {fmtDateTime(r.windowStart, tz)} → {fmtTime(r.windowEnd, tz)}{r.reason && ` — “${r.reason}”`}</span></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Affected" value={r.summary.affected} tone="amber" />
            <Stat label="Substituted" value={r.summary.substituted} tone="green" hint="Same time, new interviewer" />
            <Stat label="Moved" value={r.summary.moved} tone="blue" />
            <Stat label="Needs rebooking" value={r.summary.needsRebooking} tone={r.summary.needsRebooking ? 'red' : 'green'} />
            <Stat label="Unchanged" value={r.summary.unchanged} tone="teal" hint="Left exactly as published" />
          </div>
          {r.summary.manualReview > 0 && <Note tone="error" title={<span className="flex items-center gap-2"><ShieldAlert size={15} />{r.summary.manualReview} interview(s) need a manual decision</span>}>These interviews already have evaluations or have started, so Recruitly will not change them automatically.</Note>}
          {!r.valid && <Note tone="error" title="This plan no longer validates">The schedule changed since the preview. Discard it and create a new preview.</Note>}
          <Card title="Change report" subtitle="Every change, with before / after and the reason." pad={false}>
            {r.changes.length === 0 ? <EmptyState icon={Check} title="No changes needed" text="Nobody was scheduled with this interviewer in the cancelled window." /> : (
              <Table rows={r.changes} columns={[
                { key: 'c', header: 'Candidate', render: (c) => <div><p className="font-semibold">{c.candidateName}</p><p className="text-xs text-muted">{c.roundName}</p></div> },
                { key: 't', header: 'Change', render: (c) => <Badge tone={TYPE[c.type]?.[0] || 'gray'}>{TYPE[c.type]?.[1] || label(c.type)}</Badge> },
                { key: 'b', header: 'Before', render: (c) => <Side s={c.before} tz={tz} /> },
                { key: 'a', header: '', className: 'w-8', render: () => <ArrowRight size={15} className="text-muted" /> },
                { key: 'af', header: 'After', render: (c) => (c.after ? <Side s={c.after} tz={tz} /> : <span className="text-xs font-semibold text-amber">Candidate must rebook</span>) },
                { key: 'r', header: 'Why', render: (c) => <span className="text-xs text-muted">{c.reason}</span> },
                ...(r.status === 'approved' ? [{ key: 'n', header: 'Delivery', render: (c) => <div className="text-xs"><p>Calendar: {label(c.calendarStatus)}</p><p>Notice: {label(c.notificationStatus)}</p></div> }] : []),
              ]} />
            )}
          </Card>
          {r.status === 'preview' && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" icon={X} loading={busy === 'discard'} onClick={() => act('discard')}>Discard plan</Button>
              <Button icon={Check} disabled={!r.valid} onClick={() => setConfirm(true)}>Approve &amp; apply</Button>
            </div>
          )}
          <Confirm open={confirm} title="Apply this reschedule?" confirmLabel="Apply changes" loading={busy === 'approve'} onClose={() => setConfirm(false)} onConfirm={() => act('approve')}
            text={`${r.changes.filter((c) => c.after).length} interview(s) will change and everyone affected will be notified. The plan is re-validated at the moment you approve; if anything changed meanwhile you'll be asked to preview again.`} />
        </div>
      )}
    </Async>
  );
}

export default function Reschedule() {
  const { driveId } = useDrive();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');
  const ivs = useAsync(() => get(`/drives/${driveId}/interviewers`), [driveId], { skip: !driveId });
  const runs = useAsync(() => get(`/drives/${driveId}/reschedules`), [driveId], { skip: !driveId });
  const [form, setForm] = useState({ interviewerId: '', date: '', whole: false, from: '13:00', to: '17:00', reason: '' });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (runId) setOpen(true); }, [runId]);

  const preview = async (drive) => {
    if (!form.interviewerId || !form.date) return toast.error('Choose an interviewer and a date');
    setBusy(true);
    try {
      const r = await post(`/interviewers/${form.interviewerId}/cancel-availability`, { date: form.date, ...(form.whole ? {} : { startTime: form.from, endTime: form.to }), reason: form.reason || undefined });
      toast.success('Preview created. Nothing has changed yet.');
      const plan = r.plans?.find((p) => p.driveId === driveId) || r.plans?.[0];
      await runs.reload({ silent: true });
      if (plan) setParams({ run: plan.runId });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  void zonedToIso;
  return (
    <DriveGate>
      {(drive) => (
        <>
          <PageHeader title="Reschedule" subtitle="When an interviewer becomes unavailable, Recruitly proposes the smallest set of changes. You review a preview first — nothing moves until you approve." />
          <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
            <Card title="Interviewer became unavailable">
              <div className="space-y-3">
                <Field label="Interviewer"><select className="input" value={form.interviewerId} onChange={(e) => setForm({ ...form, interviewerId: e.target.value })}><option value="">Select…</option>{(ivs.data || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
                <Field label="Date" hint={`Drive runs ${dateOnly(drive.startDate)} → ${dateOnly(drive.endDate)}`}><input type="date" className="input" value={form.date} min={dateOnly(drive.startDate)} max={dateOnly(drive.endDate)} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.whole} onChange={(e) => setForm({ ...form, whole: e.target.checked })} />Whole day</label>
                {!form.whole && <div className="grid grid-cols-2 gap-3"><Field label="From"><input type="time" className="input" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field><Field label="To"><input type="time" className="input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field></div>}
                <Field label="Reason (optional)"><input className="input" maxLength={200} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Family emergency" /></Field>
                <Button className="w-full" icon={Eye} loading={busy} onClick={() => preview(drive)}>Preview changes</Button>
                <p className="text-xs text-muted">Tip: a half-day cancellation is usually fully absorbed by substitutes. A full-day cancellation can force candidates to rebook.</p>
              </div>
            </Card>
            <Card title="Plans" subtitle="Previews wait for your approval" pad={false}>
              <Async state={runs} skeleton={<div className="skeleton m-5 h-40" />} isEmpty={(r) => !r.length} empty={<EmptyState icon={RefreshCcw} title="No reschedule plans" text="Create a preview from the form to see the minimal set of changes." />}>
                {(rows) => <Table rows={rows} onRow={(r) => setParams({ run: r.id })} columns={[
                  { key: 'w', header: 'Interviewer', render: (r) => <b>{r.interviewerName}</b> },
                  { key: 'cr', header: 'Created', render: (r) => fmtDateTime(r.createdAt, drive.timezone) },
                  { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'a', header: 'Affected', render: (r) => r.summary.affected },
                  { key: 'm', header: 'Moved', render: (r) => r.summary.moved },
                  { key: 'rb', header: 'Rebook', render: (r) => r.summary.needsRebooking },
                ]} />}
              </Async>
            </Card>
          </div>
          <Modal open={open && !!runId} onClose={() => { setOpen(false); setParams({}); }} title="Reschedule plan" size="xl">
            {runId && <RunDetail driveId={driveId} runId={runId} tz={drive.timezone} onChanged={() => runs.reload({ silent: true })} />}
          </Modal>
        </>
      )}
    </DriveGate>
  );
}
