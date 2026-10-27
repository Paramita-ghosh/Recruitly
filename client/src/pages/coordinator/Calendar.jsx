import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { Async, Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import ScheduleCalendar from '../../components/shared/ScheduleCalendar';
import SessionModal from '../../components/shared/SessionModal';
import { ROUND_COLORS } from '../../lib/utils';
import { CalendarDays } from 'lucide-react';

export default function Calendar() {
  const { driveId } = useDrive();
  const [roundId, setRoundId] = useState('');
  const [mode, setMode] = useState('');
  const [selected, setSelected] = useState(null);
  const st = useAsync(() => get(`/drives/${driveId}/schedules`, roundId ? { roundId } : undefined), [driveId, roundId], { skip: !driveId });
  const filtered = useMemo(() => (st.data || []).filter((s) => !mode || s.mode === mode), [st.data, mode]);
  return (
    <DriveGate>
      {(drive) => (
        <>
          <PageHeader title="Schedule calendar" subtitle="Click any interview to see details, move it (with live constraint checking) or cancel it."
            actions={<Button variant="secondary" icon={RefreshCw} onClick={() => st.reload()}>Refresh</Button>} />
          <Card pad={false}>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
              <select className="input w-auto py-1.5 text-xs font-semibold" value={roundId} onChange={(e) => setRoundId(e.target.value)} aria-label="Round"><option value="">All rounds</option>{drive.rounds.map((r) => <option key={r.id} value={r.id}>{r.position}. {r.name}</option>)}</select>
              <select className="input w-auto py-1.5 text-xs font-semibold" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode"><option value="">Online + offline</option><option value="offline">Offline only</option><option value="online">Online only</option></select>
              <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted">
                {drive.rounds.map((r, i) => <span key={r.id} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: ROUND_COLORS[i % ROUND_COLORS.length] }} />{r.name}</span>)}
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-muted" />Completed</span>
                <Badge tone="gray">{filtered.filter((s) => s.status !== 'cancelled').length} interviews</Badge>
              </div>
            </div>
            <div className="p-4">
              <Async state={st} skeleton={<div className="skeleton h-[560px]" />} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={CalendarDays} title="No interviews scheduled" text="Open the schedule generator to create the first schedule." />}>
                {() => <ScheduleCalendar sessions={filtered} timezone={drive.timezone} initialDate={drive.startDate} dayStart={drive.dayStart} dayEnd={drive.dayEnd} onSelect={setSelected} />}
              </Async>
            </div>
          </Card>
          <SessionModal session={selected} onClose={() => setSelected(null)} onChanged={() => st.reload({ silent: true })} />
        </>
      )}
    </DriveGate>
  );
}
