import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, Clock3, Link2, Sparkles } from 'lucide-react';
import { get, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Async, Badge, Button, Card, EmptyState, Note, PageHeader, StatusBadge } from '../../components/ui';
import { InterviewCard } from '../../components/shared/InterviewList';

export function useBookingLink() {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const go = async (driveId) => {
    setBusy(driveId);
    try { const r = await post('/candidate/booking-link', { driveId }); navigate(new URL(r.url, window.location.origin).pathname); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  return { go, busy };
}

export default function CandidateDashboard() {
  const { user } = useAuth();
  const st = useAsync(() => get('/dashboard'), []);
  const { go, busy } = useBookingLink();
  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Share your availability, book your slot and follow your progress." />
      <Async state={st}>
        {(d) => (
          <div className="space-y-6">
            {!d.hasAvailability && <Note tone="warn" title="Add your availability so we can schedule you"><div className="mt-1 flex flex-wrap items-center gap-3"><span>Without it the scheduler cannot place you in any interview.</span><Link to="/candidate/availability" className="btn-primary btn-sm">Add availability</Link></div></Note>}
            <div className="grid gap-6 xl:grid-cols-3">
              <Card title="Your next interview" className="xl:col-span-2">
                {d.upcoming.length === 0 ? <EmptyState icon={CalendarClock} title="No interview scheduled yet" text="When your interview is scheduled — or when you're invited to pick a slot — it appears here." /> : <div className="space-y-3">{d.upcoming.map((s) => <InterviewCard key={s.id} s={s} viewer="candidate" />)}</div>}
              </Card>
              <Card title="Quick actions">
                <div className="space-y-2">
                  <Link to="/candidate/availability" className="btn-secondary w-full justify-start"><Clock3 size={16} />Update my availability</Link>
                  <Link to="/candidate/progress" className="btn-secondary w-full justify-start"><Sparkles size={16} />See my progress</Link>
                </div>
              </Card>
            </div>
            <Card title="My drives" action={<Link to="/candidate/drives" className="flex items-center gap-1 text-xs font-semibold text-brand">All drives<ArrowRight size={13} /></Link>}>
              {d.drives.length === 0 ? <EmptyState title="You're not part of any drive yet" text="Your placement coordinator will add you to a drive." /> : (
                <div className="grid gap-4 md:grid-cols-2">{d.drives.map((dr) => (
                  <div key={dr.id} className="rounded-xl border border-line p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-brand">{dr.companyName}</p><p className="font-bold">{dr.name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={dr.status} />{dr.roundName && <Badge tone="blue">{dr.roundName}</Badge>}<span className="text-xs text-muted">{dr.totalRounds} rounds</span></div>
                    {['awaiting_booking', 'eligible', 'needs_rebooking'].includes(dr.status) && <Button size="sm" icon={Link2} className="mt-3" loading={busy === dr.id} onClick={() => go(dr.id)}>Choose my interview time</Button>}
                  </div>
                ))}</div>
              )}
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}
