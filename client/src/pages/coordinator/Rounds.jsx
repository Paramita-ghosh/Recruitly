import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { del, get, patch, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, Confirm, EmptyState, Field, Modal, PageHeader, Toggle } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import { label, ROUND_COLORS } from '../../lib/utils';

function RoundForm({ round, rounds, skills, onClose, onSaved, driveId }) {
  const toast = useToast();
  const edit = !!round;
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({
    defaultValues: edit ? { ...round, skillIds: round.skills.map((s) => s.id), modes: round.allowedModes, equipment: round.requiredEquipment.join(', '), prereq: round.prerequisiteRoundId || '', minRoomCapacity: round.minRoomCapacity ?? '' }
      : { name: '', durationMinutes: 30, panelSize: 1, modes: ['offline', 'online'], skillIds: [], passThreshold: 60, requiresReview: false, bookingPolicy: 'self_book', equipment: '', prereq: rounds.at(-1)?.id || '', minRoomCapacity: '' },
  });
  const [reqs, setReqs] = useState(edit ? round.panelRequirements.map((p) => ({ skillId: p.skillId ?? p.skill_id, minCount: p.minCount ?? p.min_count })) : []);
  const [err, setErr] = useState('');
  const skillIds = watch('skillIds') || [];
  const modes = watch('modes') || [];
  const toggleIn = (field, arr, v) => setValue(field, arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const submit = async (v) => {
    setErr('');
    if (!modes.length) return setErr('Choose at least one mode');
    const body = {
      name: v.name, durationMinutes: Number(v.durationMinutes), panelSize: Number(v.panelSize), allowedModes: modes, passThreshold: Number(v.passThreshold), requiresReview: !!v.requiresReview, bookingPolicy: v.bookingPolicy,
      requiredEquipment: v.equipment ? v.equipment.split(',').map((s) => s.trim()).filter(Boolean) : [], minRoomCapacity: v.minRoomCapacity ? Number(v.minRoomCapacity) : null,
      prerequisiteRoundId: v.prereq || null, skillIds: skillIds.map(Number), panelRequirements: reqs.filter((r) => r.skillId).map((r) => ({ skillId: Number(r.skillId), minCount: Number(r.minCount) || 1 })),
    };
    try { edit ? await patch(`/rounds/${round.id}`, body) : await post(`/drives/${driveId}/rounds`, body); toast.success(edit ? 'Round updated' : 'Round added'); onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={edit ? `Edit ${round.name}` : 'Add round'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={handleSubmit(submit)}>{edit ? 'Save round' : 'Add round'}</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)} noValidate>
        {err && <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad sm:col-span-2" role="alert">{err}</p>}
        <Field className="sm:col-span-2" label="Round name" error={errors.name?.message}><input className="input" {...register('name', { required: 'Name the round', minLength: { value: 2, message: 'Too short' } })} /></Field>
        <Field label="Duration (min)"><input type="number" className="input" min="5" step="5" {...register('durationMinutes')} /></Field>
        <Field label="Panel size"><input type="number" className="input" min="1" max="5" {...register('panelSize')} /></Field>
        <Field label="Pass threshold (0–100)"><input type="number" className="input" min="0" max="100" {...register('passThreshold')} /></Field>
        <Field label="Booking"><select className="input" {...register('bookingPolicy')}><option value="self_book">Candidates self-book</option><option value="auto">Auto-schedule after previous round</option></select></Field>
        <Field label="Prerequisite round"><select className="input" {...register('prereq')}><option value="">None</option>{rounds.filter((r) => r.id !== round?.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Min room capacity"><input type="number" className="input" min="1" {...register('minRoomCapacity')} /></Field>
        <Field className="sm:col-span-2" label="Allowed modes"><div className="flex gap-2">{['offline', 'online'].map((m) => <button key={m} type="button" onClick={() => toggleIn('modes', modes, m)} className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${modes.includes(m) ? 'border-brand bg-brand text-white' : 'border-line'}`}>{label(m)}</button>)}</div></Field>
        <Field className="sm:col-span-2" label="Required skills (every panelist must have all of them)">
          <div className="flex flex-wrap gap-2">{skills.map((s) => <button key={s.id} type="button" onClick={() => toggleIn('skillIds', skillIds, s.id)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${skillIds.includes(s.id) ? 'border-teal bg-teal text-white' : 'border-line hover:bg-soft'}`}>{s.name}</button>)}</div>
        </Field>
        <div className="sm:col-span-2">
          <p className="label">Panel composition (at least N panelists with a skill)</p>
          <div className="space-y-2">
            {reqs.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className="input" value={r.skillId} onChange={(e) => setReqs(reqs.map((x, j) => (j === i ? { ...x, skillId: e.target.value } : x)))}><option value="">Skill…</option>{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                <input className="input w-24" type="number" min="1" max="5" value={r.minCount} onChange={(e) => setReqs(reqs.map((x, j) => (j === i ? { ...x, minCount: e.target.value } : x)))} aria-label="Minimum count" />
                <button type="button" onClick={() => setReqs(reqs.filter((_, j) => j !== i))} className="text-muted hover:text-bad" aria-label="Remove"><Trash2 size={16} /></button>
              </div>
            ))}
            <Button type="button" size="sm" variant="secondary" icon={Plus} onClick={() => setReqs([...reqs, { skillId: '', minCount: 1 }])}>Add requirement</Button>
          </div>
        </div>
        <Field className="sm:col-span-2" label="Required room equipment (comma separated)"><input className="input" placeholder="projector, whiteboard" {...register('equipment')} /></Field>
        <div className="sm:col-span-2"><Toggle checked={!!watch('requiresReview')} onChange={(v) => setValue('requiresReview', v)} label="Coordinator must review before a result is final (otherwise auto-finalised when the panel completes)" /></div>
      </form>
    </Modal>
  );
}

export default function Rounds() {
  const { driveId, rounds, reloadDetail } = useDrive();
  const toast = useToast();
  const skills = useAsync(() => get('/skills'), []);
  const [form, setForm] = useState(null);
  const [rm, setRm] = useState(null);
  const remove = async () => { try { await del(`/rounds/${rm.id}`); toast.success('Round removed'); setRm(null); reloadDetail(); } catch (e) { toast.error(errMsg(e)); setRm(null); } };
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Rounds" subtitle="The interview pipeline for this drive. Candidates move through rounds in order." actions={<Button icon={Plus} onClick={() => setForm({})}>Add round</Button>} />
          {rounds.length === 0 ? <Card><EmptyState icon={Layers} title="No rounds yet" text="Add a round to define duration, panel and required skills." /></Card> : (
            <div className="grid gap-4">
              {rounds.map((r, i) => (
                <Card key={r.id}>
                  <div className="flex flex-wrap items-start gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-extrabold text-white" style={{ background: ROUND_COLORS[i % ROUND_COLORS.length] }}>{r.position}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-extrabold">{r.name}</h3>{r.requiresReview && <Badge tone="violet">Coordinator review</Badge>}<Badge tone={r.hasRubric ? 'green' : 'amber'}>{r.hasRubric ? 'Rubric ready' : 'No rubric'}</Badge></div>
                      <p className="mt-1 text-sm text-muted">{r.durationMinutes} min · panel of {r.panelSize} · {r.allowedModes.map(label).join(' & ')} · pass ≥ {r.passThreshold} · {label(r.bookingPolicy)}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">{r.skills.map((s) => <Badge key={s.id} tone="teal">{s.name}</Badge>)}{r.panelRequirements.map((p, k) => <Badge key={k} tone="violet">≥{p.minCount ?? p.min_count} with {skills.data?.find((s) => s.id === (p.skillId ?? p.skill_id))?.name || 'skill'}</Badge>)}{r.requiredEquipment.map((e) => <Badge key={e} tone="gray">{e}</Badge>)}</div>
                    </div>
                    <div className="flex gap-2"><Button size="sm" variant="secondary" icon={Pencil} onClick={() => setForm(r)}>Edit</Button><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRm(r)} aria-label="Delete round" /></div>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {form && skills.data && <RoundForm round={form.id ? form : null} rounds={rounds} skills={skills.data} driveId={driveId} onClose={() => setForm(null)} onSaved={reloadDetail} />}
          <Confirm open={!!rm} danger title={`Delete ${rm?.name}?`} confirmLabel="Delete round" onClose={() => setRm(null)} onConfirm={remove} text="Rounds that already have interviews cannot be deleted. Their rubric is removed with them." />
        </>
      )}
    </DriveGate>
  );
}
