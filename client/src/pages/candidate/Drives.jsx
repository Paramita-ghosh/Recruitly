import { Briefcase, Link2 } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { Async, Badge, Button, Card, EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { dateOnly } from '../../lib/utils';
import { useBookingLink } from './Dashboard';

export default function CandidateDrives() {
  const drives = useAsync(() => get('/drives'), []);
  const dash = useAsync(() => get('/dashboard'), []);
  const { go, busy } = useBookingLink();
  return (
    <>
      <PageHeader title="Drives" subtitle="Recruitment drives you've been added to." />
      <Async state={drives} isEmpty={(l) => !l.length} empty={<Card><EmptyState icon={Briefcase} title="No drives yet" text="Your placement coordinator will add you." /></Card>}>
        {(list) => (
          <div className="grid gap-5 lg:grid-cols-2">
            {list.map((d) => {
              const mine = dash.data?.drives.find((x) => x.id === d.id);
              return (
                <Card key={d.id}>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand">{d.companyName}</p>
                  <h3 className="text-lg font-extrabold">{d.name}</h3>
                  <p className="mt-1 text-xs text-muted">{dateOnly(d.startDate)} → {dateOnly(d.endDate)} · {d.dayStart}–{d.dayEnd} ({d.timezone})</p>
                  {d.description && <p className="mt-3 text-sm text-muted">{d.description}</p>}
                  <div className="mt-4 flex flex-wrap items-center gap-2"><StatusBadge status={d.status} />{mine && <Badge tone="violet">Your stage: {mine.status.replace(/_/g, ' ')}</Badge>}{d.selfBookingEnabled ? <Badge tone="green">Self-booking on</Badge> : <Badge>Coordinator schedules</Badge>}</div>
                  {d.selfBookingEnabled && mine && ['awaiting_booking', 'needs_rebooking', 'eligible'].includes(mine.status) && <Button className="mt-4" size="sm" icon={Link2} loading={busy === d.id} onClick={() => go(d.id)}>Choose my interview time</Button>}
                </Card>
              );
            })}
          </div>
        )}
      </Async>
    </>
  );
}
