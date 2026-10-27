import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { get, patch, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Async, Button, Card, Field } from '../ui';
import { cn } from '../../lib/utils';

const MODES = [['offline_only', 'Offline only', 'In-person interviews only'], ['online_only', 'Online only', 'Video interviews only'], ['both_prefer_offline', 'Both · prefer offline', 'Either, but in-person when possible'], ['both_prefer_online', 'Both · prefer online', 'Either, but video when possible']];

export default function ProfileEditor({ section = 'all' }) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const st = useAsync(() => get('/users/me/profile'), []);
  const skills = useAsync(() => get('/skills'), [], { skip: user.role !== 'interviewer' });
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const p = st.data; if (!p) return;
    setF({ name: p.name, phone: p.phone || '', bio: p.bio || '', candidate: { regNo: '', department: '', branch: '', gradYear: '', cgpa: '', ...(p.candidate || {}) }, interviewer: { dailyCapacity: 8, minBreakMinutes: 0, modes: 'both_prefer_offline', title: '', ...(p.interviewer || {}) }, skillIds: (p.interviewer?.skills || []).map((s) => s.id) });
  }, [st.data]);
  if (!f) return <Async state={st}>{() => null}</Async>;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setSub = (g, k, v) => setF((x) => ({ ...x, [g]: { ...x[g], [k]: v } }));
  const save = async () => {
    setBusy(true);
    const body = {};
    if (section === 'all') { body.name = f.name; body.phone = f.phone || null; body.bio = f.bio || null; }
    if (user.role === 'candidate' && section === 'all') body.candidate = { regNo: f.candidate.regNo || undefined, department: f.candidate.department || undefined, branch: f.candidate.branch || undefined, gradYear: f.candidate.gradYear ? Number(f.candidate.gradYear) : undefined, cgpa: f.candidate.cgpa !== '' && f.candidate.cgpa != null ? Number(f.candidate.cgpa) : undefined };
    if (user.role === 'interviewer') body.interviewer = { dailyCapacity: Number(f.interviewer.dailyCapacity), minBreakMinutes: Number(f.interviewer.minBreakMinutes), modes: f.interviewer.modes, ...(section === 'all' ? { title: f.interviewer.title || undefined, skillIds: f.skillIds } : {}) };
    try { await patch('/users/me/profile', body); toast.success('Saved'); refresh(); st.reload({ silent: true }); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const iv = user.role === 'interviewer';
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {section === 'all' && (
        <Card title="Personal details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Email"><input className="input" value={st.data.email} disabled /></Field>
            {iv && <Field label="Job title"><input className="input" value={f.interviewer.title} onChange={(e) => setSub('interviewer', 'title', e.target.value)} /></Field>}
            <Field className="sm:col-span-2" label="Bio"><textarea className="input" rows={3} maxLength={1000} value={f.bio} onChange={(e) => set('bio', e.target.value)} /></Field>
          </div>
        </Card>
      )}
      {user.role === 'candidate' && (
        <Card title="Academic details" subtitle="Used for drive eligibility.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Registration no."><input className="input" value={f.candidate.regNo} onChange={(e) => setSub('candidate', 'regNo', e.target.value)} /></Field>
            <Field label="Graduation year"><input type="number" className="input" value={f.candidate.gradYear} onChange={(e) => setSub('candidate', 'gradYear', e.target.value)} /></Field>
            <Field label="Department"><input className="input" value={f.candidate.department} onChange={(e) => setSub('candidate', 'department', e.target.value)} /></Field>
            <Field label="Branch"><input className="input" value={f.candidate.branch} onChange={(e) => setSub('candidate', 'branch', e.target.value)} /></Field>
            <Field label="CGPA"><input type="number" step="0.01" min="0" max="10" className="input" value={f.candidate.cgpa} onChange={(e) => setSub('candidate', 'cgpa', e.target.value)} /></Field>
          </div>
        </Card>
      )}
      {iv && (
        <Card title="Interview preferences" subtitle="The scheduler respects these as hard constraints (mode, capacity, breaks) and soft preferences.">
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">{MODES.map(([k, l, d]) => <button key={k} type="button" onClick={() => setSub('interviewer', 'modes', k)} className={cn('rounded-xl border p-3 text-left transition', f.interviewer.modes === k ? 'border-brand bg-brand/5 ring-2 ring-brand/25' : 'border-line hover:bg-soft')}><p className="text-sm font-bold">{l}</p><p className="text-xs text-muted">{d}</p></button>)}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Max interviews per day"><input type="number" min="1" max="30" className="input" value={f.interviewer.dailyCapacity} onChange={(e) => setSub('interviewer', 'dailyCapacity', e.target.value)} /></Field>
              <Field label="Minimum break (min)"><input type="number" min="0" max="120" step="5" className="input" value={f.interviewer.minBreakMinutes} onChange={(e) => setSub('interviewer', 'minBreakMinutes', e.target.value)} /></Field>
            </div>
          </div>
        </Card>
      )}
      {iv && section === 'all' && (
        <Card title="Skills" subtitle="Rounds need specific skills. You are only matched to rounds you qualify for.">
          <div className="flex flex-wrap gap-2">{(skills.data || []).map((s) => { const on = f.skillIds.includes(s.id); return <button key={s.id} type="button" onClick={() => set('skillIds', on ? f.skillIds.filter((x) => x !== s.id) : [...f.skillIds, s.id])} className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', on ? 'border-teal bg-teal text-white' : 'border-line hover:bg-soft')}>{s.name}</button>; })}</div>
        </Card>
      )}
      <div className="xl:col-span-2"><Button icon={Save} loading={busy} onClick={save}>Save changes</Button></div>
    </div>
  );
}
