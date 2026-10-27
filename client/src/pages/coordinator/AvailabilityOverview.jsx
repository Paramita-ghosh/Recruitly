import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { Async, Avatar, Badge, Button, Card, EmptyState, Modal, PageHeader, Progress, Stat, Tabs } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import AvailabilityEditor from '../../components/shared/AvailabilityEditor';
import { modesLabel } from '../../lib/utils';
import { Users, UserCog, AlertTriangle } from 'lucide-react';

export default function AvailabilityOverview() {
  const { driveId } = useDrive();
  const [tab, setTab] = useState('interviewers');
  const [edit, setEdit] = useState(null);
  const st = useAsync(() => get('/availability/overview', { driveId }), [driveId], { skip: !driveId });
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Availability overview" subtitle="Who has told us when they are free? Empty rows are the most common reason a candidate cannot be scheduled." />
          <Async state={st}>
            {(d) => {
              const rows = tab === 'interviewers' ? d.interviewers : d.candidates;
              const missing = rows.filter((r) => !r.hasAvailability).length;
              const max = Math.max(60, ...rows.map((r) => r.minutes));
              return (
                <>
                  <div className="mb-6 grid gap-4 sm:grid-cols-3">
                    <Stat label="Interviewer hours" value={`${Math.round(d.totalInterviewerMinutes / 60)} h`} icon={UserCog} tone="violet" />
                    <Stat label="Candidates with availability" value={`${d.candidates.filter((c) => c.hasAvailability).length}/${d.candidates.length}`} icon={Users} tone="teal" />
                    <Stat label="Missing availability" value={d.candidates.filter((c) => !c.hasAvailability).length + d.interviewers.filter((c) => !c.hasAvailability).length} icon={AlertTriangle} tone="amber" />
                  </div>
                  <Tabs value={tab} onChange={setTab} tabs={[{ id: 'interviewers', label: 'Interviewers', count: d.interviewers.length }, { id: 'candidates', label: 'Candidates', count: d.candidates.length }]} />
                  <Card pad={false}>
                    {rows.length === 0 ? <EmptyState icon={Clock3} title="Nobody in this list yet" /> : (
                      <ul className="divide-y divide-line">
                        {rows.map((r) => (
                          <li key={r.userId} className="grid items-center gap-3 px-5 py-3 md:grid-cols-[260px_1fr_auto]">
                            <div className="flex items-center gap-3"><Avatar name={r.name} size={32} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{r.name}</p>{tab === 'interviewers' && <p className="truncate text-xs text-muted">{r.skills?.join(', ')} · {modesLabel(r.modes)}</p>}</div></div>
                            <div>{r.hasAvailability ? (<><Progress value={(r.minutes / max) * 100} tone="brand" /><p className="mt-1 text-xs text-muted">{Math.round(r.minutes / 60 * 10) / 10} h across {r.days.length} day(s){r.preferredMinutes ? ` · ${Math.round(r.preferredMinutes / 60 * 10) / 10} h preferred` : ''}{tab === 'interviewers' ? ` · cap ${r.dailyCapacity}/day` : ''}</p></>) : <Badge tone="red" dot>No availability in the drive dates</Badge>}</div>
                            <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>Edit</Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  {missing > 0 && <p className="mt-3 text-xs text-muted">{missing} {tab} have no availability in the drive dates.</p>}
                </>
              );
            }}
          </Async>
          <Modal open={!!edit} onClose={() => { setEdit(null); st.reload({ silent: true }); }} title={`Availability · ${edit?.name}`} size="xl">{edit && <AvailabilityEditor userId={edit.userId} allowPreferred={edit.role === 'candidate'} />}</Modal>
        </>
      )}
    </DriveGate>
  );
}
