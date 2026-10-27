import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, List, Video } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { Async, Card, EmptyState, PageHeader, Tabs } from '../../components/ui';
import { InterviewCard } from '../../components/shared/InterviewList';
import ScheduleCalendar from '../../components/shared/ScheduleCalendar';
import { useNavigate } from 'react-router-dom';
import { dayKey, fmtDateLong } from '../../lib/utils';

export function InterviewsPage({ role, pendingOnly }) {
  const [tab, setTab] = useState(pendingOnly ? 'pending_evaluation' : 'upcoming');
  const [view, setView] = useState('list');
  const navigate = useNavigate();
  const st = useAsync(() => get('/interviews', { scope: tab }), [tab]);
  const act = (s) => (role === 'interviewer' ? <Link className="btn-primary btn-sm" to={`/interviewer/interviews/${s.id}`}>{s.resultStatus === 'pending' ? 'Evaluate' : 'View'}</Link> : null);
  const tabs = pendingOnly ? [{ id: 'pending_evaluation', label: 'To evaluate' }, { id: 'past', label: 'History' }] : [{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }];
  return (
    <>
      <PageHeader title={pendingOnly ? 'Evaluations' : role === 'candidate' ? 'My interviews' : 'My interviews'} subtitle={pendingOnly ? 'Submit scores once an interview has started or finished. Scores stay blinded until the panel completes.' : 'Everything scheduled for you. Add any interview to your calendar with the .ics button.'}
        actions={!pendingOnly && <div className="flex rounded-lg border border-line p-0.5"><button onClick={() => setView('list')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === 'list' ? 'bg-brand text-white' : 'text-muted'}`}><List size={14} className="mr-1 inline" />List</button><button onClick={() => setView('cal')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === 'cal' ? 'bg-brand text-white' : 'text-muted'}`}><CalendarDays size={14} className="mr-1 inline" />Calendar</button></div>} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <Async state={st} skeleton={<div className="skeleton h-56" />} isEmpty={(l) => !l.length} empty={<Card><EmptyState icon={Video} title="Nothing here" text={pendingOnly ? 'No evaluations waiting.' : 'No interviews in this view yet.'} /></Card>}>
        {(list) => view === 'cal' && !pendingOnly ? <Card><ScheduleCalendar sessions={list} timezone={list[0]?.timezone} showCandidate={role !== 'candidate'} height={620} onSelect={(s) => role === 'interviewer' && navigate(`/interviewer/interviews/${s.id}`)} /></Card> : (
          <div className="space-y-6">
            {Object.entries(list.reduce((a, s) => { (a[dayKey(s.startsAt, s.timezone)] ||= []).push(s); return a; }, {})).map(([d, items]) => (
              <section key={d}><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{fmtDateLong(items[0].startsAt, items[0].timezone)}</h3><div className="space-y-3">{items.map((s) => <InterviewCard key={s.id} s={s} viewer={role} actions={act(s)} />)}</div></section>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}

export default function InterviewerInterviews() { return <InterviewsPage role="interviewer" />; }
