import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, UploadCloud } from 'lucide-react';
import { api, download, errMsg } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, Note, PageHeader, Stat, Table, Tabs } from '../../components/ui';
import { cn } from '../../lib/utils';

const HELP = {
  candidates: 'Columns: name, email, reg_no, department, branch, grad_year, drive (optional). Candidates are invited by email and set their own password – no passwords are ever created from a CSV.',
  interviewers: 'Columns: name, email, company, skills (separated by ;), daily_capacity, modes (offline/online/both), preferred_mode. Skills must already exist.',
};
const TONE = { new: 'green', invalid: 'red', duplicate_file: 'amber', duplicate_db: 'amber' };

export default function Import() {
  const toast = useToast();
  const [kind, setKind] = useState('candidates');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef(null);

  const send = async (mode) => {
    const fd = new FormData();
    fd.append('file', file);
    return (await api.post(`/imports/${kind}${mode === 'commit' ? '?mode=commit' : ''}`, fd)).data.data;
  };
  const pick = async (f) => {
    if (!f) return;
    setFile(f); setPreview(null); setResult(null); setBusy('preview');
    try {
      const fd = new FormData(); fd.append('file', f);
      setPreview((await api.post(`/imports/${kind}`, fd)).data.data);
    } catch (e) { toast.error(errMsg(e)); setFile(null); } finally { setBusy(''); }
  };
  const commit = async () => {
    setBusy('commit');
    try { const r = await send('commit'); setResult(r); setPreview(null); toast.success(`${r.summary.created} account(s) invited`); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  const saveCsv = (text, name) => { const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
  const reset = () => { setFile(null); setPreview(null); setResult(null); if (input.current) input.current.value = ''; };

  return (
    <>
      <PageHeader title="CSV import" subtitle="Validate first, then import. Nothing is written until you confirm the preview." actions={<Button variant="secondary" icon={Download} onClick={() => download(`/imports/templates/${kind}`, `${kind}-template.csv`).catch((e) => toast.error(errMsg(e)))}>Download template</Button>} />
      <Tabs value={kind} onChange={(k) => { setKind(k); reset(); }} tabs={[{ id: 'candidates', label: 'Candidates' }, { id: 'interviewers', label: 'Interviewers' }]} />
      <div className="mb-5"><Note tone="info">{HELP[kind]}</Note></div>

      {!preview && !result && (
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={cn('card flex flex-col items-center justify-center border-2 border-dashed px-6 py-16 text-center transition', drag ? 'border-brand bg-brand/5' : 'border-line')}>
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-brand/10 text-brand"><UploadCloud size={30} /></div>
          <p className="text-lg font-bold">Drop a CSV file here</p>
          <p className="mt-1 text-sm text-muted">or choose a file from your computer (max 2 MB)</p>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files[0])} />
          <Button className="mt-5" icon={FileUp} loading={busy === 'preview'} onClick={() => input.current?.click()}>Choose CSV file</Button>
        </div>
      )}

      {preview && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Rows" value={preview.summary.total} tone="blue" />
            <Stat label="Ready to import" value={preview.summary.valid} icon={CheckCircle2} tone="green" />
            <Stat label="Invalid" value={preview.summary.invalid} icon={AlertTriangle} tone={preview.summary.invalid ? 'red' : 'green'} />
            <Stat label="Duplicates" value={preview.summary.duplicates} tone={preview.summary.duplicates ? 'amber' : 'green'} hint="Skipped" />
          </div>
          <Card title={`Preview · ${file?.name}`} pad={false} action={<div className="flex gap-2">{preview.errorCsv && <Button size="sm" variant="secondary" icon={Download} onClick={() => saveCsv(preview.errorCsv, 'import-errors.csv')}>Error report</Button>}<Button size="sm" variant="ghost" onClick={reset}>Choose another</Button></div>}>
            <Table dense rows={preview.rows} rowKey="line" columns={[
              { key: 'line', header: 'Line', className: 'w-16' },
              { key: 'name', header: 'Name' }, { key: 'email', header: 'Email' },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={TONE[r.status] || 'gray'}>{r.status.replace('_', ' ')}</Badge> },
              { key: 'errors', header: 'Problems', render: (r) => <span className="text-xs text-bad">{r.errors.join('; ')}</span> },
            ]} />
          </Card>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={reset}>Cancel</Button><Button icon={CheckCircle2} disabled={!preview.summary.valid} loading={busy === 'commit'} onClick={commit}>Import {preview.summary.valid} valid row(s)</Button></div>
        </div>
      )}

      {result && (
        <Card title="Import complete">
          <div className="grid gap-4 sm:grid-cols-3"><Stat label="Invited" value={result.summary.created} tone="green" /><Stat label="Failed" value={result.summary.failed} tone={result.summary.failed ? 'red' : 'green'} /><Stat label="Skipped" value={result.summary.skipped} tone="amber" /></div>
          <p className="mt-4 text-sm text-muted">Each new person received an invitation link to set their own password. If SMTP is not configured, the links are recorded in the server log (see README).</p>
          <div className="mt-4 flex gap-2">{result.errorCsv && <Button variant="secondary" icon={Download} onClick={() => saveCsv(result.errorCsv, 'import-errors.csv')}>Download error report</Button>}<Button onClick={reset}>Import another file</Button></div>
        </Card>
      )}
    </>
  );
}
