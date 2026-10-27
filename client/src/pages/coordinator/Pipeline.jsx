import { useState } from 'react';
import { get, patch, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Async, Card, Note, PageHeader } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import PipelineBoard from '../../components/shared/Pipeline';
import { label } from '../../lib/utils';

export default function PipelinePage({ readOnly = false }) {
  const { driveId } = useDrive();
  const toast = useToast();
  const st = useAsync(() => get(`/drives/${driveId}/pipeline`), [driveId], { skip: !driveId });
  const [q, setQ] = useState('');
  const move = async (it, status) => {
    st.setData((d) => d.map((x) => (x.candidateId === it.candidateId ? { ...x, status } : x)));
    try { await patch(`/drives/${driveId}/candidates/${it.candidateId}/status`, { status }); toast.success(`${it.name} → ${label(status)}`); st.reload({ silent: true }); } catch (e) { toast.error(errMsg(e)); st.reload({ silent: true }); }
  };
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Pipeline" subtitle={readOnly ? 'Where every candidate is in the process.' : 'Drag a card to change a candidate’s stage manually. Automatic moves happen as evaluations are finalised.'}
            actions={<input className="input w-56" placeholder="Filter candidates…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" />} />
          {!readOnly && <div className="mb-4"><Note tone="info">Manual moves are recorded in the audit log. Use them to correct exceptions — normal progression is automatic.</Note></div>}
          <Async state={st} skeleton={<div className="skeleton h-96" />}>
            {(items) => <Card pad={false}><div className="p-4"><PipelineBoard items={items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))} onMove={readOnly ? undefined : move} hideEmail={readOnly} /></div></Card>}
          </Async>
        </>
      )}
    </DriveGate>
  );
}
