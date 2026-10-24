import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ClipboardCheck, ArrowRight } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useAuth } from '../../context/AuthContext';
import { Async, Button, Card, EmptyState, PageHeader, Stat } from '../../components/ui';
import { InterviewCard } from '../../components/shared/InterviewList';

export default function InterviewerDashboard() {
  const { user } = useAuth();
  const st = useAsync(() => get('/dashboard'), []);
  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} subtitle="Your upcoming interviews and the evaluations waiting for you." actions={<Link to="/interviewer/availability" className="btn-secondary">Update availability</Link>} />
      <Async state={st}>
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Upcoming interviews" value={d.stats.upcoming} icon={CalendarClock} tone="blue" />
              <Stat label="Evaluations to submit" value={d.stats.pendingEvaluations} icon={ClipboardCheck} tone={d.stats.pendingEvaluations ? 'amber' : 'green'} />
              <Stat label="Submitted" value={d.stats.submitted} icon={CheckCircle2} tone="green" />
            </div>
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <Card title="Coming up" action={<Link to="/interviewer/interviews" className="flex items-center gap-1 text-xs font-semibold text-brand">All interviews<ArrowRight size={13} /></Link>}>
                {d.upcoming.length === 0 ? <EmptyState icon={CalendarClock} title="No interviews scheduled" text="You'll be notified when a schedule is published." /> : <div className="space-y-3">{d.upcoming.slice(0, 4).map((s) => <InterviewCard key={s.id} s={s} viewer="interviewer" actions={<Link className="btn-secondary btn-sm" to={`/interviewer/interviews/${s.id}`}>Open</Link>} />)}</div>}
              </Card>
              <Card title="Waiting for your evaluation" action={<Link to="/interviewer/evaluations" className="flex items-center gap-1 text-xs font-semibold text-brand">All<ArrowRight size={13} /></Link>}>
                {d.pending.length === 0 ? <EmptyState icon={CheckCircle2} title="All caught up" text="No evaluations are waiting for you." /> : <div className="space-y-3">{d.pending.slice(0, 4).map((s) => <InterviewCard key={s.id} s={s} viewer="interviewer" actions={<Link className="btn-primary btn-sm" to={`/interviewer/interviews/${s.id}`}>Evaluate</Link>} />)}</div>}
              </Card>
            </div>
          </>
        )}
      </Async>
    </>
  );
}
void Button;
