import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarClock, ClipboardCheck, FolderKanban, Users, UserCog, ArrowRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useAuth } from '../../context/AuthContext';
import { getSocket } from '../../lib/socket';
import { Async, Badge, Button, Card, EmptyState, PageHeader, Stat } from '../../components/ui';
import { InterviewCard } from '../../components/shared/InterviewList';
import { label, STATUS_TONE } from '../../lib/utils';

const PIE = ['#3563E9', '#7C5CFC', '#0D9488', '#F4B942', '#16865C', '#D92D3A', '#667085'];
export const tip = { contentStyle: { background: 'rgb(var(--card))', border: '1px solid rgb(var(--border))', borderRadius: 10, fontSize: 12, color: 'rgb(var(--text))' }, cursor: { fill: 'rgba(53,99,233,.06)' } };

export default function CoordinatorDashboard() {
  const { driveId, drive } = useDrive();
  const { user } = useAuth();
  const navigate = useNavigate();
  const dash = useAsync(() => get('/dashboard'), []);
  const summary = useAsync(() => get(`/drives/${driveId}/reports/summary`), [driveId], { skip: !driveId });
  const quality = useAsync(() => get(`/drives/${driveId}/schedules/quality`), [driveId], { skip: !driveId });

  useEffect(() => {
    const s = getSocket();
    const refresh = () => { dash.reload({ silent: true }); summary.reload({ silent: true }); quality.reload({ silent: true }); };
    ['schedule:generated', 'schedule:published', 'reschedule:approved', 'evaluation:submitted', 'pipeline:changed'].forEach((e) => s.on(e, refresh));
    return () => ['schedule:generated', 'schedule:published', 'reschedule:approved', 'evaluation:submitted', 'pipeline:changed'].forEach((e) => s.off(e, refresh));
  }, [driveId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}`}
        subtitle="Here's what needs your attention across your recruitment drives."
        actions={<><Button variant="secondary" onClick={() => navigate('/coordinator/calendar')} icon={CalendarClock}>Open calendar</Button><Button onClick={() => navigate('/coordinator/generator')}>Generate schedule</Button></>} />
      <Async state={dash}>
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Active drives" value={d.stats.activeDrives} icon={FolderKanban} tone="blue" />
              <Stat label="Candidates" value={d.stats.candidates} icon={Users} tone="teal" />
              <Stat label="Interviewers" value={d.stats.interviewers} icon={UserCog} tone="violet" />
              <Stat label="Upcoming interviews" value={d.stats.upcoming} icon={CalendarClock} tone="blue" />
              <Stat label="Need attention" value={d.stats.needsAttention + d.stats.awaitingReview} icon={AlertTriangle} tone={d.stats.needsAttention ? 'amber' : 'green'} hint={`${d.stats.needsAttention} unscheduled · ${d.stats.awaitingReview} to review`} />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-3">
              <Card title="Interview load by interviewer" subtitle={drive?.name} className="xl:col-span-2">
                <Async state={summary} skeleton={<div className="skeleton h-64" />} isEmpty={(s) => !s.interviewerLoad.length} empty={<EmptyState title="No interviews yet" text="Generate a schedule to see how load is spread." />}>
                  {(s) => (
                    <div className="h-64"><ResponsiveContainer><BarChart data={s.interviewerLoad.map((i) => ({ name: i.name.split(' ')[0], Interviews: i.interviews, Capacity: i.daily_capacity }))} margin={{ left: -18 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...tip} /><Bar dataKey="Interviews" fill="#3563E9" radius={[6, 6, 0, 0]} maxBarSize={36} />
                    </BarChart></ResponsiveContainer></div>
                  )}
                </Async>
              </Card>
              <Card title="Candidate funnel" subtitle="Where everyone is right now">
                <Async state={summary} skeleton={<div className="skeleton h-64" />} isEmpty={(s) => !s.funnel.length} empty={<EmptyState title="No data" />}>
                  {(s) => (
                    <div className="flex items-center gap-4">
                      <div className="h-44 w-44 shrink-0"><ResponsiveContainer><PieChart><Pie data={s.funnel.map((f) => ({ name: label(f.status), value: f.count }))} dataKey="value" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="none">{s.funnel.map((f, i) => <Cell key={f.status} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip {...tip} /></PieChart></ResponsiveContainer></div>
                      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">{s.funnel.map((f, i) => <li key={f.status} className="flex items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PIE[i % PIE.length] }} /><span className="flex-1 truncate text-muted">{label(f.status)}</span><b>{f.count}</b></li>)}</ul>
                    </div>
                  )}
                </Async>
              </Card>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-3">
              <Card title="Next interviews" subtitle="Across all drives" className="xl:col-span-2" action={<Link to="/coordinator/calendar" className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline">Full calendar<ArrowRight size={13} /></Link>}>
                {d.upcoming.length === 0 ? <EmptyState icon={CalendarClock} title="Nothing scheduled" text="Generate and publish a schedule to see upcoming interviews here." /> : <div className="space-y-3">{d.upcoming.slice(0, 5).map((s) => <InterviewCard key={s.id} s={s} viewer="coordinator" />)}</div>}
              </Card>
              <div className="space-y-6">
                <Card title="Schedule quality" subtitle="Latest run for the current drive">
                  <Async state={quality} skeleton={<div className="skeleton h-28" />} isEmpty={(q) => !q.quality} empty={<p className="py-6 text-center text-sm text-muted">No schedule generated yet.</p>}>
                    {(q) => (
                      <div className="text-center">
                        <p className={`text-5xl font-extrabold ${q.quality.valid ? 'text-brand' : 'text-bad'}`}>{Math.round(q.quality.score)}<span className="text-lg text-muted">/100</span></p>
                        <div className="mt-2">{q.quality.valid ? <Badge tone="green" dot>0 hard-constraint violations</Badge> : <Badge tone="red" dot>{q.quality.hardConstraintViolations} violations</Badge>}</div>
                        <Link to="/coordinator/quality" className="btn-secondary btn-sm mt-4">View breakdown</Link>
                      </div>
                    )}
                  </Async>
                </Card>
                <Card title="Pipeline" subtitle="All drives">
                  {d.pipeline.length === 0 ? <p className="text-sm text-muted">No candidates yet.</p> : <ul className="space-y-2">{d.pipeline.map((p) => <li key={p.status} className="flex items-center justify-between text-sm"><Badge tone={STATUS_TONE[p.status] || 'gray'} dot>{label(p.status)}</Badge><b>{p.count}</b></li>)}</ul>}
                </Card>
              </div>
            </div>
          </>
        )}
      </Async>
    </>
  );
}
