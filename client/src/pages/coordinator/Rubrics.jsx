import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { get, put, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Async, Button, Card, Field, Note, PageHeader, Tabs } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';

function Editor({ round, onSaved }) {
  const toast = useToast();
  const st = useAsync(() => get(`/rounds/${round.id}/rubric`), [round.id]);
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (st.data) setR({ name: st.data.name, scaleMin: st.data.scaleMin, scaleMax: st.data.scaleMax, criteria: st.data.criteria.map((c) => ({ name: c.name, description: c.description || '', weight: c.weight })) }); }, [st.data]);
  if (!r && !st.loading && st.data == null) {
    return (
      <Card title="No rubric for this round yet" subtitle="Interviewers can't submit evaluations until a rubric exists.">
        {st.error && <p className="mb-3 text-sm text-bad">{st.error}</p>}
        <Button icon={Plus} onClick={() => setR({ name: `${round.name} rubric`, scaleMin: 1, scaleMax: 5, criteria: [{ name: '', description: '', weight: 100 }] })}>Create rubric</Button>
      </Card>
    );
  }
  if (!r) return <Async state={st}>{() => null}</Async>;
  const total = r.criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  const ok = Math.abs(total - 100) < 0.001;
  const upd = (i, k, v) => setR({ ...r, criteria: r.criteria.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });
  const save = async () => {
    setBusy(true);
    try { await put(`/rounds/${round.id}/rubric`, { name: r.name, scaleMin: Number(r.scaleMin), scaleMax: Number(r.scaleMax), criteria: r.criteria.map((c) => ({ name: c.name, description: c.description || undefined, weight: Number(c.weight) })) }); toast.success('Rubric saved'); onSaved?.(); st.reload({ silent: true }); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card title="Scoring criteria" subtitle="Weights must add up to exactly 100. The database enforces this too."
      action={<Button icon={Save} loading={busy} disabled={!ok || r.criteria.some((c) => !c.name.trim())} onClick={save}>Save rubric</Button>}>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Field label="Rubric name"><input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Field>
        <Field label="Scale min"><input type="number" className="input" value={r.scaleMin} onChange={(e) => setR({ ...r, scaleMin: e.target.value })} /></Field>
        <Field label="Scale max"><input type="number" className="input" value={r.scaleMax} onChange={(e) => setR({ ...r, scaleMax: e.target.value })} /></Field>
      </div>
      <div className="space-y-3">
        {r.criteria.map((c, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-[1fr_1.4fr_110px_auto] md:items-end">
            <Field label="Criterion"><input className="input" value={c.name} onChange={(e) => upd(i, 'name', e.target.value)} /></Field>
            <Field label="What good looks like"><input className="input" value={c.description} onChange={(e) => upd(i, 'description', e.target.value)} /></Field>
            <Field label="Weight %"><input type="number" className="input" min="1" max="100" value={c.weight} onChange={(e) => upd(i, 'weight', e.target.value)} /></Field>
            <Button variant="ghost" icon={Trash2} disabled={r.criteria.length === 1} onClick={() => setR({ ...r, criteria: r.criteria.filter((_, j) => j !== i) })} aria-label="Remove criterion" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" icon={Plus} disabled={r.criteria.length >= 12} onClick={() => setR({ ...r, criteria: [...r.criteria, { name: '', description: '', weight: 0 }] })}>Add criterion</Button>
        <p className={`text-sm font-bold ${ok ? 'text-ok' : 'text-bad'}`}>Total weight: {total} / 100{!ok && ` (${total > 100 ? 'remove' : 'add'} ${Math.abs(100 - total)})`}</p>
      </div>
      {!ok && <div className="mt-3"><Note tone="warn">Weights must sum to 100 before you can save.</Note></div>}
    </Card>
  );
}

export default function Rubrics() {
  const { rounds, reloadDetail } = useDrive();
  const [rid, setRid] = useState('');
  const cur = rounds.find((r) => r.id === rid) || rounds[0];
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Evaluation rubrics" subtitle="Define what interviewers score. Each round has its own weighted rubric; scores are normalised to 0–100." />
          {cur ? (<><Tabs value={cur.id} onChange={setRid} tabs={rounds.map((r) => ({ id: r.id, label: r.name }))} /><Editor key={cur.id} round={cur} onSaved={reloadDetail} /></>) : <Card><p className="text-sm text-muted">Add a round first.</p></Card>}
        </>
      )}
    </DriveGate>
  );
}
