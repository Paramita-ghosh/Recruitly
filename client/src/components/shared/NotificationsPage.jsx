import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, CalendarClock, ClipboardCheck, Mail, RefreshCcw, Info } from 'lucide-react';
import { get, patch, post } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { Async, Button, Card, EmptyState, PageHeader, SkeletonRows } from '../ui';
import { cn, fmtAgo, label } from '../../lib/utils';

const ICON = { schedule: CalendarClock, evaluation: ClipboardCheck, booking: Mail, reschedule: RefreshCcw };

export default function NotificationsPage() {
  const st = useAsync(() => get('/notifications'), []);
  const navigate = useNavigate();
  const readAll = async () => { await post('/notifications/read-all'); st.reload({ silent: true }); };
  const open = async (n) => { if (!n.read) await patch(`/notifications/${n.id}/read`).catch(() => {}); st.reload({ silent: true }); if (n.link) navigate(n.link); };
  return (
    <>
      <PageHeader title="Notifications" subtitle="Everything that happened that concerns you. In-app notifications are always recorded; emails are sent only when SMTP is configured."
        actions={<Button variant="secondary" icon={CheckCheck} onClick={readAll} disabled={!st.data?.unread}>Mark all read</Button>} />
      <Card pad={false}>
        <Async state={st} skeleton={<SkeletonRows rows={6} />} isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon={Bell} title="Nothing here yet" text="New interview schedules, results and reminders will show up here." />}>
          {(d) => (
            <ul>
              {d.items.map((n) => {
                const I = ICON[n.category] || Info;
                return (
                  <li key={n.id}>
                    <button onClick={() => open(n)} className={cn('flex w-full items-start gap-4 border-b border-line/70 px-5 py-4 text-left last:border-0 hover:bg-soft/50', !n.read && 'bg-brand/5')}>
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><I size={17} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{n.title}</span>
                        <span className="mt-0.5 block text-sm text-muted">{n.body}</span>
                        <span className="mt-1 block text-xs text-muted/80">{label(n.category)} · {fmtAgo(n.createdAt)}</span>
                      </span>
                      {!n.read && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Async>
      </Card>
    </>
  );
}
