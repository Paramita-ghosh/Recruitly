import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Check, FolderKanban, Pencil, Plus, UserCog, Users, X } from 'lucide-react';
import { del, get, patch, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Async, Avatar, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs, Toggle } from '../../components/ui';
import { dateOnly, label } from '../../lib/utils';

const STATUSES = ['draft', 'collecting_availability', 'ready_to_schedule', 'schedule_generated', 'published', 'in_progress', 'completed', 'cancelled'];

function DriveForm({ drive, companies, onClose, onSaved }) {
  const toast = useToast();
  const edit = !!drive;
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({
    defaultValues: edit ? { ...drive, startDate: dateOnly(drive.startDate), endDate: dateOnly(drive.endDate), bookingDeadline: drive.bookingDeadline?.slice(0, 16) || '', rescheduleDeadline: drive.rescheduleDeadline?.slice(0, 16) || '' }
      : { name: '', description: '', companyId: companies[0]?.id || '', timezone: 'Asia/Kolkata', startDate: '', endDate: '', dayStart: '09:00', dayEnd: '17:00', slotMinutes: 30, defaultDurationMinutes: 30, bufferMinutes: 0, modePolicy: 'any', selfBookingEnabled: true, defaultPipeline: true, bookingDeadline: '', rescheduleDeadline: '' },
  });
  const [err, setErr] = useState('');
  const submit = async (v) => {
    setErr('');
    const body = {
      name: v.name, description: v.description || null, timezone: v.timezone, startDate: v.startDate, endDate: v.endDate, dayStart: v.dayStart, dayEnd: v.dayEnd,
      slotMinutes: Number(v.slotMinutes), defaultDurationMinutes: Number(v.defaultDurationMinutes), bufferMinutes: Number(v.bufferMinutes), modePolicy: v.modePolicy, selfBookingEnabled: !!v.selfBookingEnabled,
      bookingDeadline: v.bookingDeadline ? new Date(v.bookingDeadline).toISOString() : null, rescheduleDeadline: v.rescheduleDeadline ? new Date(v.rescheduleDeadline).toISOString() : null,
      ...(edit ? { status: v.status } : { companyId: v.companyId, defaultPipeline: !!v.defaultPipeline }),
    };
    try {
      const r = edit ? await patch(`/drives/${drive.id}`, body) : await post('/drives', body);
      toast.success(edit ? 'Drive updated' : 'Drive created'); onSaved(r); onClose();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={edit ? 'Edit drive' : 'New recruitment drive'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={handleSubmit(submit)}>{edit ? 'Save changes' : 'Create drive'}</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)} noValidate>
        {err && <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad sm:col-span-2" role="alert">{err}</p>}
        <Field className="sm:col-span-2" label="Drive name" error={errors.name?.message}><input className="input" {...register('name', { required: 'Give the drive a name', minLength: { value: 3, message: 'At least 3 characters' } })} /></Field>
        {!edit && <Field label="Company / college"><select className="input" {...register('companyId', { required: true })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        {edit && <Field label="Status"><select className="input" {...register('status')}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>}
        <Field label="Time zone"><input className="input" {...register('timezone', { required: true })} placeholder="Asia/Kolkata" /></Field>
        <Field label="Start date" error={errors.startDate?.message}><input type="date" className="input" {...register('startDate', { required: 'Required' })} /></Field>
        <Field label="End date" error={errors.endDate?.message}><input type="date" className="input" {...register('endDate', { required: 'Required', validate: (v) => !watch('startDate') || v >= watch('startDate') || 'End must be on or after the start' })} /></Field>
        <Field label="Day starts"><input type="time" className="input" {...register('dayStart')} /></Field>
        <Field label="Day ends"><input type="time" className="input" {...register('dayEnd', { validate: (v) => v > watch('dayStart') || 'Must be after the start' })} /></Field>
        <Field label="Slot length (min)"><input type="number" className="input" min="5" step="5" {...register('slotMinutes')} /></Field>
        <Field label="Buffer between interviews (min)"><input type="number" className="input" min="0" step="5" {...register('bufferMinutes')} /></Field>
        <Field label="Mode policy"><select className="input" {...register('modePolicy')}><option value="any">Online and offline</option><option value="offline_only">Offline only</option><option value="online_only">Online only</option></select></Field>
        <Field label="Default interview length (min)"><input type="number" className="input" min="5" step="5" {...register('defaultDurationMinutes')} /></Field>
        <Field label="Booking deadline"><input type="datetime-local" className="input" {...register('bookingDeadline')} /></Field>
        <Field label="Reschedule deadline"><input type="datetime-local" className="input" {...register('rescheduleDeadline')} /></Field>
        <Field className="sm:col-span-2" label="Description"><textarea className="input" rows={2} {...register('description')} /></Field>
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          <Toggle checked={!!watch('selfBookingEnabled')} onChange={(v) => setValue('selfBookingEnabled', v)} label="Allow candidate self-booking" />
          {!edit && <Toggle checked={!!watch('defaultPipeline')} onChange={(v) => setValue('defaultPipeline', v)} label="Create Coding → Technical → HR rounds" />}
        </div>
      </form>
    </Modal>
  );
}

function Members({ drive, onClose, onChanged }) {
  const toast = useToast();
  const [tab, setTab] = useState('candidates');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set());
  const inDrive = useAsync(() => get(`/drives/${drive.id}/${tab}`), [drive.id, tab]);
  const all = useAsync(() => get(`/${tab}`, q ? { search: q } : undefined), [tab, q]);
  const ids = new Set((inDrive.data || []).map((x) => x.id));
  const candidates = (all.data || []).filter((x) => !ids.has(x.id));
  const add = async (body) => {
    try { await post(`/drives/${drive.id}/${tab}`, body); toast.success('Added'); setSel(new Set()); inDrive.reload({ silent: true }); onChanged?.(); } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async (id) => { try { await del(`/drives/${drive.id}/${tab}/${id}`); inDrive.reload({ silent: true }); onChanged?.(); } catch (e) { toast.error(errMsg(e)); } };
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal open onClose={onClose} title={`People · ${drive.name}`} size="xl">
      <Tabs value={tab} onChange={(t) => { setTab(t); setSel(new Set()); setQ(''); }} tabs={[{ id: 'candidates', label: 'Candidates' }, { id: 'interviewers', label: 'Interviewers' }]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="label">In this drive ({inDrive.data?.length ?? '…'})</p>
          <div className="scroll-thin max-h-96 space-y-1.5 overflow-y-auto">
            <Async state={inDrive} skeleton={<div className="skeleton h-40" />} isEmpty={(l) => !l.length} empty={<p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">Nobody added yet.</p>}>
              {(l) => l.map((p) => <div key={p.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"><Avatar name={p.name} size={28} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{p.name}</p><p className="truncate text-xs text-muted">{p.email}</p></div><button onClick={() => remove(p.id)} className="text-muted hover:text-bad" aria-label={`Remove ${p.name}`}><X size={15} /></button></div>)}
            </Async>
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between"><p className="label !mb-0">Add from directory</p><button className="text-xs font-semibold text-brand hover:underline" onClick={() => add({ all: true })}>Add everyone</button></div>
          <input className="input mb-2" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="scroll-thin max-h-72 space-y-1.5 overflow-y-auto">
            {candidates.length === 0 && <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">No one else to add.</p>}
            {candidates.slice(0, 100).map((p) => <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-soft/50"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /><Avatar name={p.name} size={26} /><span className="min-w-0 flex-1 truncate text-sm">{p.name}</span></label>)}
          </div>
          <Button className="mt-3 w-full" icon={Plus} disabled={!sel.size} onClick={() => add({ ids: [...sel] })}>Add {sel.size || ''} selected</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function Drives() {
  const { drives, reload, setDriveId, driveId, loading, reloadDetail } = useDrive();
  const toast = useToast();
  const companies = useAsync(() => get('/companies'), []);
  const [form, setForm] = useState(null);
  const [people, setPeople] = useState(null);
  const approve = async (d, ok) => { try { await post(`/drives/${d.id}/${ok ? 'approve' : 'reject'}`); toast.success(ok ? 'Drive approved' : 'Drive rejected'); reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <>
      <PageHeader title="Recruitment drives" subtitle="A drive groups a company, its rounds, candidates, interviewers and rooms for a set of dates." actions={<Button icon={Plus} onClick={() => setForm({})} disabled={!companies.data?.length}>New drive</Button>} />
      {loading ? <div className="skeleton h-48" /> : drives.length === 0 ? (
        <Card><EmptyState icon={FolderKanban} title="Create your first drive" text="You need a company first, then a drive with dates and rounds." action={<Button icon={Plus} onClick={() => setForm({})} disabled={!companies.data?.length}>New drive</Button>} /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {drives.map((d) => (
            <Card key={d.id} className={d.id === driveId ? 'ring-2 ring-brand/40' : ''}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-brand">{d.companyName}</p><h3 className="mt-0.5 truncate text-lg font-extrabold">{d.name}</h3><p className="mt-1 text-xs text-muted">{dateOnly(d.startDate)} → {dateOnly(d.endDate)} · {d.dayStart}–{d.dayEnd} · {d.timezone}</p></div>
                <div className="flex flex-col items-end gap-1.5"><StatusBadge status={d.status} />{d.approvalStatus !== 'approved' && <Badge tone="amber">{label(d.approvalStatus)}</Badge>}</div>
              </div>
              {d.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{d.description}</p>}
              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                {[['Candidates', d.counts.candidates], ['Interviewers', d.counts.interviewers], ['Rounds', d.counts.rounds], ['Sessions', d.counts.sessions]].map(([l, n]) => <div key={l} className="rounded-lg bg-soft py-2"><p className="text-lg font-extrabold">{n}</p><p className="text-[10px] font-semibold uppercase text-muted">{l}</p></div>)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant={d.id === driveId ? 'primary' : 'secondary'} icon={d.id === driveId ? Check : undefined} onClick={() => setDriveId(d.id)}>{d.id === driveId ? 'Current drive' : 'Switch to this drive'}</Button>
                <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setForm(d)}>Edit</Button>
                <Button size="sm" variant="secondary" icon={Users} onClick={() => setPeople(d)}>People</Button>
                {d.approvalStatus === 'pending' && <><Button size="sm" icon={Check} onClick={() => approve(d, true)}>Approve</Button><Button size="sm" variant="danger" icon={X} onClick={() => approve(d, false)}>Reject</Button></>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {form && companies.data && <DriveForm drive={form.id ? form : null} companies={companies.data} onClose={() => setForm(null)} onSaved={(r) => { reload().then(() => { if (!form.id && r?.id) setDriveId(r.id); reloadDetail(); }); }} />}
      {people && <Members drive={people} onClose={() => setPeople(null)} onChanged={() => { reload(); reloadDetail(); }} />}
    </>
  );
}
void UserCog;
