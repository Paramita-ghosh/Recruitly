import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Lightbulb } from 'lucide-react';
import { get, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Async, Avatar, Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import AvailabilityEditor from '../../components/shared/AvailabilityEditor';
import { Modal } from '../../components/ui';
import { label } from '../../lib/utils';

const FIX = {
  candidate_no_availability: 'Ask the candidate to add availability, or add it on their behalf.',
  candidate_no_fit: 'Their availability windows are shorter than the interview. Ask for longer windows.',
  insufficient_panel: 'Not enough qualified interviewers are free together. Add interviewer availability or reduce the panel size.',
  interviewer_busy: 'All qualified interviewers are already booked. Add interviewers or open more time.',
  no_room: 'No suitable room is free. Add a room, or allow online mode.',
  mode_conflict: 'The panel and candidate cannot share a mode. Relax mode restrictions.',
};

export default function Unscheduled() {
  const { driveId, rounds } = useDrive();
  const toast = useToast();
  const [roundId, setRoundId] = useState('');
  const [edit, setEdit] = useState(null);
  const st = useAsync(() => get(`/drives/${driveId}/unscheduled`, roundId ? { roundId } : undefined), [driveId, roundId], { skip: !driveId });
  const link = async (it, rid) => {
    try { await post('/booking-links', { driveId, roundId: rid, candidateId: it.candidateId }); toast.success(`Booking invitation prepared for ${it.name}`); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Unscheduled & conflicts" subtitle="Every candidate the solver could not place comes with a plain-language reason and a suggested fix."
            actions={<select className="input w-auto" value={roundId} onChange={(e) => setRoundId(e.target.value)} aria-label="Round"><option value="">Latest run</option>{rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>} />
          <Async state={st} isEmpty={(d) => !d.items.length} empty={<Card><EmptyState icon={CheckCircle2} title="Everyone is scheduled" text="The latest run placed every requested candidate." /></Card>}>
            {(d) => (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted"><Badge tone="amber" dot>{d.items.length} unscheduled</Badge><Badge tone={d.status === 'partial' ? 'amber' : 'gray'}>{label(d.status)} run</Badge><span>{d.proven} of {d.items.length} are proven infeasible (not a solver limitation).</span></div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {d.items.map((it) => (
                    <Card key={it.candidateId}>
                      <div className="flex items-start gap-3">
                        <Avatar name={it.name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><p className="font-bold">{it.name}</p><Badge tone="amber">{label(it.primary)}</Badge>{it.proven && <Badge tone="gray">Proven</Badge>}</div>
                          <ul className="mt-3 space-y-2">
                            {it.reasons.map((r, i) => (
                              <li key={i} className="flex gap-2 text-sm"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber" /><span><span className="text-ink">{r.message}</span>{r.slots != null && r.slots > 0 && <span className="text-muted"> ({r.slots} slot{r.slots === 1 ? '' : 's'} affected)</span>}</span></li>
                            ))}
                          </ul>
                          {FIX[it.primary] && <p className="mt-3 flex gap-2 rounded-lg bg-brand/5 p-3 text-xs text-muted"><Lightbulb size={14} className="mt-0.5 shrink-0 text-brand" />{FIX[it.primary]}</p>}
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setEdit(it)}>Edit availability</Button>
                            <Button size="sm" icon={Link2} onClick={() => link(it, d.roundId)}>Send booking link</Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </Async>
          <Modal open={!!edit} onClose={() => setEdit(null)} title={`Availability · ${edit?.name}`} size="xl">{edit && <AvailabilityEditor userId={edit.candidateId} allowPreferred title="Candidate availability" />}</Modal>
        </>
      )}
    </DriveGate>
  );
}
