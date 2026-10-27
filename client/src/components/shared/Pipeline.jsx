import { Avatar, Badge, EmptyState } from '../ui';
import { fmtDateTime, label, cn } from '../../lib/utils';
import { Kanban } from 'lucide-react';

export const COLUMNS = [
  { id: 'eligible', label: 'Eligible', tone: 'bg-muted' },
  { id: 'awaiting_booking', label: 'Awaiting booking', tone: 'bg-amber' },
  { id: 'scheduled', label: 'Scheduled', tone: 'bg-brand' },
  { id: 'evaluation_pending', label: 'Evaluation pending', tone: 'bg-violet' },
  { id: 'passed', label: 'Passed', tone: 'bg-ok' },
  { id: 'failed', label: 'Not selected', tone: 'bg-bad' },
  { id: 'needs_rebooking', label: 'Needs rebooking', tone: 'bg-amber' },
];

export default function PipelineBoard({ items, onMove, onOpen, hideEmail }) {
  if (!items.length) return <EmptyState icon={Kanban} title="No candidates in this drive yet" text="Add candidates to the drive to see them move through the pipeline." />;
  const cols = COLUMNS.filter((c) => items.some((i) => i.status === c.id) || ['awaiting_booking', 'scheduled', 'passed', 'failed'].includes(c.id));
  return (
    <div className="scroll-thin -mx-1 flex gap-4 overflow-x-auto px-1 pb-3">
      {cols.map((c) => {
        const list = items.filter((i) => i.status === c.id);
        return (
          <div key={c.id} className="flex w-[285px] shrink-0 flex-col rounded-xl2 bg-soft/70 p-3"
            onDragOver={(e) => onMove && e.preventDefault()}
            onDrop={(e) => { if (!onMove) return; const id = e.dataTransfer.getData('text/plain'); const it = items.find((x) => x.candidateId === id); if (it && it.status !== c.id) onMove(it, c.id); }}>
            <div className="mb-3 flex items-center justify-between px-1">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink"><i className={cn('h-2.5 w-2.5 rounded-full', c.tone)} />{c.label}</p>
              <Badge tone="gray">{list.length}</Badge>
            </div>
            <div className="scroll-thin flex max-h-[62vh] flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
              {list.length === 0 && <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">Nothing here</p>}
              {list.map((i) => (
                <div key={i.candidateId} draggable={!!onMove} onDragStart={(e) => e.dataTransfer.setData('text/plain', i.candidateId)} onClick={() => onOpen?.(i)}
                  className={cn('card p-3 transition hover:shadow-pop', onMove && 'cursor-grab active:cursor-grabbing', onOpen && 'cursor-pointer')}>
                  <div className="flex items-center gap-2.5"><Avatar name={i.name} size={30} />
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{i.name}</p>{!hideEmail && <p className="truncate text-[11px] text-muted">{i.regNo || i.email}</p>}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {i.roundName && <Badge tone="blue">{i.roundName}</Badge>}
                    {i.session?.mode && <Badge tone={i.session.mode === 'online' ? 'violet' : 'teal'}>{label(i.session.mode)}</Badge>}
                  </div>
                  {i.session?.startsAt && <p className="mt-2 text-[11px] text-muted">{fmtDateTime(i.session.startsAt)}</p>}
                  {i.session?.score != null && <p className="mt-1 text-[11px] font-semibold text-ink">Score {Math.round(i.session.score)}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
