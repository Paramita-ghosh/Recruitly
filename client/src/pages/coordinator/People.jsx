import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Clock3, MailPlus, Send, UserCog, Users } from 'lucide-react';
import { get, patch, post, errMsg } from '../../lib/api';
import { useAsync, useDebounced } from '../../lib/hooks';
import { useToast } from '../../context/ToastContext';
import { Async, Avatar, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Table, Toggle } from '../../components/ui';
import AvailabilityEditor from '../../components/shared/AvailabilityEditor';
import { fmtAgo, modesLabel } from '../../lib/utils';

function InviteForm({ role, companies, onClose, onSaved }) {
  const toast = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { role, name: '', email: '', companyId: companies[0]?.id || '', title: '' } });
  const [err, setErr] = useState('');
  const submit = async (v) => {
    try {
      await post('/users/invite', { name: v.name, email: v.email, role, ...(role === 'interviewer' || role === 'company' ? { companyId: v.companyId || undefined } : {}), ...(v.title ? { title: v.title } : {}) });
      toast.success('Invitation prepared. The person sets their own password from the link.'); onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Invite ${role}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={MailPlus} loading={isSubmitting} onClick={handleSubmit(submit)}>Send invite</Button></>}>
      <form className="space-y-4" onSubmit={handleSubmit(submit)} noValidate>
        {err && <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad" role="alert">{err}</p>}
        <Field label="Full name" error={errors.name?.message}><input className="input" {...register('name', { required: 'Required', minLength: { value: 2, message: 'Too short' } })} /></Field>
        <Field label="Email" error={errors.email?.message}><input className="input" type="email" {...register('email', { required: 'Required', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Invalid email' } })} /></Field>
        {role === 'interviewer' && <><Field label="Organisation"><select className="input" {...register('companyId')}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Job title"><input className="input" {...register('title')} /></Field></>}
      </form>
    </Modal>
  );
}

function ProfileModal({ person, onClose }) {
  const st = useAsync(() => get(`/users/${person.id}/profile`), [person.id]);
  return (
    <Modal open onClose={onClose} title={person.name} size="sm">
      <Async state={st} skeleton={<div className="skeleton h-32" />}>
        {(p) => (
          <dl className="space-y-3 text-sm">
            <div><dt className="label">Email</dt><dd>{p.email}</dd></div>
            {p.phone && <div><dt className="label">Phone</dt><dd>{p.phone}</dd></div>}
            {p.candidate && <><div><dt className="label">Registration</dt><dd>{p.candidate.regNo || '—'}</dd></div><div><dt className="label">Branch</dt><dd>{p.candidate.branch || '—'} {p.candidate.gradYear ? `· ${p.candidate.gradYear}` : ''}</dd></div>{p.candidate.cgpa != null && <div><dt className="label">CGPA</dt><dd>{p.candidate.cgpa}</dd></div>}</>}
            {p.interviewer && <><div><dt className="label">Title</dt><dd>{p.interviewer.title || '—'}</dd></div><div><dt className="label">Skills</dt><dd className="flex flex-wrap gap-1.5">{p.interviewer.skills.map((s) => <Badge key={s.id} tone="teal">{s.name}</Badge>)}</dd></div><div><dt className="label">Modes</dt><dd>{modesLabel(p.interviewer.modes)}</dd></div><div><dt className="label">Daily capacity</dt><dd>{p.interviewer.dailyCapacity} interviews</dd></div></>}
            {p.bio && <div><dt className="label">Bio</dt><dd>{p.bio}</dd></div>}
          </dl>
        )}
      </Async>
    </Modal>
  );
}

export default function People({ kind }) {
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('search') || '');
  useEffect(() => { setQ(params.get('search') || ''); }, [kind, params]);
  const dq = useDebounced(q, 300);
  const st = useAsync(() => get(`/${kind}`, dq ? { search: dq } : undefined), [kind, dq]);
  const companies = useAsync(() => get('/companies'), []);
  const [invite, setInvite] = useState(false);
  const [view, setView] = useState(null);
  const [avail, setAvail] = useState(null);
  const isC = kind === 'candidates';
  const toggle = async (p) => { try { await patch(`/users/${p.id}/active`, { active: !p.active }); st.reload({ silent: true }); } catch (e) { toast.error(errMsg(e)); } };
  const resend = async (p) => { try { await post(`/users/${p.id}/resend-invite`); toast.success('Invitation re-sent'); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <>
      <PageHeader title={isC ? 'Candidates' : 'Interviewers'} subtitle={isC ? 'Everyone who can be scheduled. Candidates register themselves or are imported via CSV.' : 'People who conduct interviews. They are invited by email and set their own passwords.'}
        actions={<><input className="input w-56" placeholder={`Search ${kind}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />{!isC && <Button icon={MailPlus} onClick={() => setInvite(true)} disabled={!companies.data}>Invite interviewer</Button>}</>} />
      <Card pad={false}>
        <Async state={st} skeleton={<div className="skeleton m-5 h-64" />} isEmpty={(l) => !l.length} empty={<EmptyState icon={isC ? Users : UserCog} title={q ? 'No matches' : `No ${kind} yet`} text={q ? 'Try a different search.' : 'Import a CSV or invite people to get started.'} />}>
          {(rows) => <Table rows={rows} columns={[
            { key: 'n', header: 'Name', render: (p) => <button className="flex items-center gap-3 text-left" onClick={() => setView(p)}><Avatar name={p.name} size={32} /><div><p className="font-semibold">{p.name}</p><p className="text-xs text-muted">{p.email}</p></div></button> },
            ...(isC ? [{ key: 'b', header: 'Branch', render: (p) => <span className="text-sm">{p.branch || '—'}<span className="block text-xs text-muted">{p.regNo || ''} {p.gradYear ? `· ${p.gradYear}` : ''}</span></span> }]
              : [{ key: 's', header: 'Skills', render: (p) => <div className="flex max-w-xs flex-wrap gap-1">{p.skills.slice(0, 4).map((s) => <Badge key={s} tone="teal">{s}</Badge>)}{p.skills.length > 4 && <Badge>+{p.skills.length - 4}</Badge>}</div> }, { key: 'm', header: 'Modes', render: (p) => <span className="text-xs">{modesLabel(p.modes)}<span className="block text-muted">cap {p.dailyCapacity}/day</span></span> }]),
            { key: 'av', header: 'Availability', render: (p) => (p.availabilityBlocks ? <Badge tone="green" dot>{p.availabilityBlocks} blocks</Badge> : <Badge tone="red" dot>None</Badge>) },
            { key: 'st', header: 'Account', render: (p) => (!p.activated ? <Badge tone="amber">Invited</Badge> : p.active ? <span className="text-xs text-muted">{p.lastLoginAt ? `Seen ${fmtAgo(p.lastLoginAt)}` : 'Active'}</span> : <Badge tone="red">Disabled</Badge>) },
            { key: 'a', header: '', className: 'text-right', render: (p) => <div className="flex items-center justify-end gap-1"><Button size="sm" variant="ghost" icon={Clock3} onClick={() => setAvail(p)}>Availability</Button>{!p.activated && <Button size="sm" variant="ghost" icon={Send} onClick={() => resend(p)}>Resend</Button>}<Toggle checked={p.active} onChange={() => toggle(p)} /></div> },
          ]} />}
        </Async>
      </Card>
      {invite && companies.data && <InviteForm role="interviewer" companies={companies.data} onClose={() => setInvite(false)} onSaved={() => st.reload({ silent: true })} />}
      {view && <ProfileModal person={view} onClose={() => setView(null)} />}
      <Modal open={!!avail} onClose={() => { setAvail(null); st.reload({ silent: true }); }} title={`Availability · ${avail?.name}`} size="xl">{avail && <AvailabilityEditor userId={avail.id} allowPreferred={isC} />}</Modal>
    </>
  );
}
