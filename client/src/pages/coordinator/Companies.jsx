import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Building2, ExternalLink, Pencil, Plus } from 'lucide-react';
import { get, patch, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useToast } from '../../context/ToastContext';
import { Async, Badge, Button, Card, EmptyState, Field, Modal, PageHeader } from '../../components/ui';

export function CompanyForm({ company, onClose, onSaved, canKind = true }) {
  const toast = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: company || { name: '', kind: 'company', description: '', website: '', industry: '', location: '' } });
  const [err, setErr] = useState('');
  const submit = async (v) => {
    const body = { name: v.name, kind: v.kind, description: v.description || undefined, website: v.website || undefined, industry: v.industry || undefined, location: v.location || undefined };
    try { company ? await patch(`/companies/${company.id}`, body) : await post('/companies', body); toast.success('Saved'); onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={company ? 'Edit company' : 'Add company'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={handleSubmit(submit)}>Save</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)} noValidate>
        {err && <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad sm:col-span-2" role="alert">{err}</p>}
        <Field className="sm:col-span-2" label="Name" error={errors.name?.message}><input className="input" {...register('name', { required: 'Required', minLength: { value: 2, message: 'Too short' } })} /></Field>
        {canKind && <Field label="Type"><select className="input" {...register('kind')}><option value="company">Company</option><option value="college">College</option></select></Field>}
        <Field label="Industry"><input className="input" {...register('industry')} /></Field>
        <Field label="Website"><input className="input" placeholder="https://…" {...register('website')} /></Field>
        <Field label="Location"><input className="input" {...register('location')} /></Field>
        <Field className="sm:col-span-2" label="Description"><textarea className="input" rows={3} maxLength={1000} {...register('description')} /></Field>
      </form>
    </Modal>
  );
}

export default function Companies() {
  const st = useAsync(() => get('/companies'), []);
  const [form, setForm] = useState(null);
  return (
    <>
      <PageHeader title="Companies & colleges" subtitle="Organisations that run recruitment drives." actions={<Button icon={Plus} onClick={() => setForm({})}>Add company</Button>} />
      <Async state={st} isEmpty={(l) => !l.length} empty={<Card><EmptyState icon={Building2} title="No companies yet" action={<Button icon={Plus} onClick={() => setForm({})}>Add company</Button>} /></Card>}>
        {(list) => (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {list.map((c) => (
              <Card key={c.id}>
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-violet text-lg font-extrabold text-white">{c.name[0]}</span>
                  <div className="min-w-0 flex-1"><h3 className="truncate font-extrabold">{c.name}</h3><p className="text-xs text-muted">{[c.industry, c.location].filter(Boolean).join(' · ') || 'No details yet'}</p></div>
                  <Badge tone={c.kind === 'college' ? 'violet' : 'blue'}>{c.kind}</Badge>
                </div>
                {c.description && <p className="mt-3 line-clamp-3 text-sm text-muted">{c.description}</p>}
                <div className="mt-4 flex items-center gap-3 text-xs text-muted"><span><b className="text-ink">{c.drive_count}</b> drive(s)</span>{c.website && <a href={c.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Website<ExternalLink size={11} /></a>}</div>
                <Button size="sm" variant="secondary" icon={Pencil} className="mt-4" onClick={() => setForm(c)}>Edit</Button>
              </Card>
            ))}
          </div>
        )}
      </Async>
      {form && <CompanyForm company={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => st.reload({ silent: true })} />}
    </>
  );
}
