import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { DoorOpen, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { del, get, patch, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Async, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Toggle } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import { fmtDateTime, zonedToIso } from '../../lib/utils';

function RoomForm({ room, driveId, onClose, onSaved }) {
  const toast = useToast();
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({ defaultValues: room ? { ...room, equipment: (room.equipment || []).join(', ') } : { name: '', location: '', capacity: 4, equipment: '', accessible: false } });
  const [err, setErr] = useState('');
  const submit = async (v) => {
    const body = { name: v.name, location: v.location || null, capacity: Number(v.capacity), equipment: v.equipment ? v.equipment.split(',').map((s) => s.trim()).filter(Boolean) : [], accessible: !!v.accessible };
    try { room ? await patch(`/rooms/${room.id}`, body) : await post(`/drives/${driveId}/rooms`, body); toast.success(room ? 'Room updated' : 'Room added'); onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={room ? 'Edit room' : 'Add room'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={handleSubmit(submit)}>Save</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)} noValidate>
        {err && <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad sm:col-span-2" role="alert">{err}</p>}
        <Field className="sm:col-span-2" label="Room name" error={errors.name?.message}><input className="input" {...register('name', { required: 'Required' })} /></Field>
        <Field label="Location"><input className="input" placeholder="Block A, Floor 2" {...register('location')} /></Field>
        <Field label="Capacity"><input type="number" className="input" min="1" {...register('capacity')} /></Field>
        <Field className="sm:col-span-2" label="Equipment (comma separated)"><input className="input" placeholder="projector, whiteboard" {...register('equipment')} /></Field>
        <div className="sm:col-span-2"><Toggle checked={!!watch('accessible')} onChange={(v) => setValue('accessible', v)} label="Wheelchair accessible" /></div>
      </form>
    </Modal>
  );
}

function BlockForm({ room, tz, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ date: '', from: '09:00', to: '10:00', reason: '' });
  const save = async () => {
    if (!f.date) return toast.error('Pick a date');
    try { await post(`/rooms/${room.id}/blocks`, { startsAt: zonedToIso(f.date, f.from, tz), endsAt: zonedToIso(f.date, f.to, tz), reason: f.reason || undefined }); toast.success('Room blocked'); onSaved(); onClose(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Block ${room.name}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Block time</Button></>}>
      <div className="space-y-3">
        <Field label="Date"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="From"><input type="time" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="To"><input type="time" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
        <Field label="Reason"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Maintenance, exam…" /></Field>
      </div>
    </Modal>
  );
}

export default function Rooms() {
  const { driveId } = useDrive();
  const toast = useToast();
  const st = useAsync(() => get(`/drives/${driveId}/rooms`), [driveId], { skip: !driveId });
  const [form, setForm] = useState(null);
  const [block, setBlock] = useState(null);
  const toggle = async (r) => { try { await patch(`/rooms/${r.id}`, { isActive: !r.is_active }); st.reload({ silent: true }); } catch (e) { toast.error(errMsg(e)); } };
  const rmBlock = async (id) => { try { await del(`/room-blocks/${id}`); st.reload({ silent: true }); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <DriveGate>
      {(drive) => (
        <>
          <PageHeader title="Rooms" subtitle="Offline interviews need a room with enough capacity and the right equipment. Block rooms when they're unavailable." actions={<Button icon={Plus} onClick={() => setForm({})}>Add room</Button>} />
          <Async state={st} isEmpty={(l) => !l.length} empty={<Card><EmptyState icon={DoorOpen} title="No rooms yet" text="Without rooms, only online interviews can be scheduled." action={<Button icon={Plus} onClick={() => setForm({})}>Add a room</Button>} /></Card>}>
            {(rooms) => (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {rooms.map((r) => (
                  <Card key={r.id} className={r.is_active ? '' : 'opacity-60'}>
                    <div className="flex items-start justify-between"><div><h3 className="text-base font-extrabold">{r.name}</h3><p className="text-xs text-muted">{r.location || 'No location set'}</p></div><Badge tone="blue">{r.capacity} seats</Badge></div>
                    <div className="mt-3 flex flex-wrap gap-1.5">{(r.equipment || []).map((e) => <Badge key={e} tone="gray">{e}</Badge>)}{r.accessible && <Badge tone="green">Accessible</Badge>}</div>
                    {r.blocks?.length > 0 && <div className="mt-4 space-y-1.5"><p className="label">Blocked</p>{r.blocks.map((b) => <div key={b.id} className="flex items-center justify-between rounded-lg bg-amber/10 px-3 py-1.5 text-xs"><span>{fmtDateTime(b.startsAt, drive.timezone)} {b.reason && `· ${b.reason}`}</span><button onClick={() => rmBlock(b.id)} className="text-muted hover:text-bad" aria-label="Remove block"><Trash2 size={13} /></button></div>)}</div>}
                    <div className="mt-4 flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" icon={Pencil} onClick={() => setForm(r)}>Edit</Button><Button size="sm" variant="secondary" icon={Wrench} onClick={() => setBlock(r)}>Block time</Button><div className="ml-auto"><Toggle checked={r.is_active} onChange={() => toggle(r)} label="Active" /></div></div>
                  </Card>
                ))}
              </div>
            )}
          </Async>
          {form && <RoomForm room={form.id ? form : null} driveId={driveId} onClose={() => setForm(null)} onSaved={() => st.reload({ silent: true })} />}
          {block && <BlockForm room={block} tz={drive.timezone} onClose={() => setBlock(null)} onSaved={() => st.reload({ silent: true })} />}
        </>
      )}
    </DriveGate>
  );
}
