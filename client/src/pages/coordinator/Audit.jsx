import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { Async, Badge, Card, EmptyState, PageHeader, Table } from '../../components/ui';
import { fmtDateTime } from '../../lib/utils';

const GROUPS = ['', 'auth', 'schedule', 'reschedule', 'booking', 'evaluation', 'drive', 'user', 'import', 'pipeline'];
const tone = (a) => (a.startsWith('auth') ? 'gray' : a.includes('cancel') || a.includes('deactivate') ? 'red' : a.includes('generate') || a.includes('publish') ? 'blue' : a.includes('reschedule') ? 'violet' : 'green');

export default function Audit() {
  const [action, setAction] = useState('');
  const [open, setOpen] = useState(null);
  const st = useAsync(() => get('/audit', { limit: 200, ...(action ? { action } : {}) }), [action]);
  return (
    <>
      <PageHeader title="Audit log" subtitle="An append-only record of who did what. Newest first." actions={<select className="input w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">{GROUPS.map((g) => <option key={g} value={g}>{g ? `${g}.*` : 'All actions'}</option>)}</select>} />
      <Card pad={false}>
        <Async state={st} skeleton={<div className="skeleton m-5 h-72" />} isEmpty={(l) => !l.length} empty={<EmptyState icon={ScrollText} title="No audit entries" />}>
          {(rows) => <Table rows={rows} onRow={(r) => setOpen(open === r.id ? null : r.id)} columns={[
            { key: 'createdAt', header: 'When', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span> },
            { key: 'actor', header: 'Actor' },
            { key: 'action', header: 'Action', render: (r) => <Badge tone={tone(r.action)}>{r.action}</Badge> },
            { key: 'entity', header: 'Entity', render: (r) => <span className="text-xs text-muted">{r.entityType}{r.entityId ? ` · ${String(r.entityId).slice(0, 8)}` : ''}</span> },
            { key: 'details', header: 'Details', render: (r) => (open === r.id ? <pre className="max-w-md whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(r.details, null, 2)}</pre> : <span className="line-clamp-1 max-w-xs text-xs text-muted">{r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : '—'}</span>) },
          ]} />}
        </Async>
      </Card>
    </>
  );
}
