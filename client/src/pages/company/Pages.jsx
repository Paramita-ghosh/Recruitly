import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CalendarClock, Download, FolderKanban, Pencil, Trophy, Users } from 'lucide-react';
import { download, errMsg, get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Async, Avatar, Badge, Button, Card, EmptyState, PageHeader, Progress, Stat, StatusBadge, Table } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import { InterviewCard } from '../../components/shared/InterviewList';
import ScheduleCalendar from '../../components/shared/ScheduleCalendar';
import { CompanyForm } from '../coordinator/Companies';
import { tip } from '../coordinator/Dashboard';
import { dateOnly, label } from '../../lib/utils';

export function CompanyDashboard() {
  const { user } = useAuth();
  const st = useAsync(() => get('/dashboard'), []);
  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Your hiring funnel and upcoming interviews at a glance." />
      <Async state={st}>
        {(d) => {
          const total = (f) => Object.values(f).reduce((a, b) => a + b, 0);
          return (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Drives" value={d.drives.length} icon={FolderKanban} tone="blue" />
                <Stat label="Candidates in funnel" value={d.drives.reduce((a, x) => a + total(x.funnel), 0)} icon={Users} tone="teal" />
                <Stat label="Upcoming interviews" value={d.upcoming.length} icon={CalendarClock} tone="violet" />
              </div>
              <div className="grid gap-6 xl:grid-cols-2">
                {d.drives.map((dr) => (
                  <Card key={dr.id} title={dr.name} subtitle={`${dateOnly(dr.startDate)} → ${dateOnly(dr.endDate)}`} action={<StatusBadge status={dr.status} />}>
                    <ul className="space-y-3">{Object.entries(dr.funnel).map(([k, v]) => <li key={k}><div className="mb-1 flex justify-between text-sm"><span className="text-muted">{label(k)}</span><b>{v}</b></div><Progress value={(v / Math.max(1, total(dr.funnel))) * 100} /></li>)}</ul>
                  </Card>
                ))}
              </div>
              <Card title="Upcoming interviews">{d.upcoming.length === 0 ? <EmptyState icon={CalendarClock} title="Nothing scheduled yet" /> : <div className="space-y-3">{d.upcoming.slice(0, 5).map((s) => <InterviewCard key={s.id} s={s} viewer="company" />)}</div>}</Card>
            </div>
          );
        }}
      </Async>
    </>
  );
}

export function CompanyDrives() {
  const { drives, setDriveId, driveId, loading } = useDrive();
  return (
    <>
      <PageHeader title="Drives" subtitle="Recruitment drives run for your company." />
      {loading ? <div className="skeleton h-40" /> : drives.length === 0 ? <Card><EmptyState icon={FolderKanban} title="No drives yet" text="Your placement partner will create one for you." /></Card> : (
        <div className="grid gap-5 lg:grid-cols-2">{drives.map((d) => (
          <Card key={d.id} className={d.id === driveId ? 'ring-2 ring-brand/40' : ''}>
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-extrabold">{d.name}</h3><p className="text-xs text-muted">{dateOnly(d.startDate)} → {dateOnly(d.endDate)} · {d.timezone}</p></div><StatusBadge status={d.status} /></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">{[['Candidates', d.counts.candidates], ['Rounds', d.counts.rounds], ['Interviews', d.counts.sessions]].map(([l, n]) => <div key={l} className="rounded-lg bg-soft py-2"><p className="text-lg font-extrabold">{n}</p><p className="text-[10px] font-semibold uppercase text-muted">{l}</p></div>)}</div>
            <Button size="sm" className="mt-4" variant={d.id === driveId ? 'primary' : 'secondary'} onClick={() => setDriveId(d.id)}>{d.id === driveId ? 'Current drive' : 'Use this drive'}</Button>
          </Card>
        ))}</div>
      )}
    </>
  );
}

export function CompanyCandidates() {
  const { driveId } = useDrive();
  const [q, setQ] = useState('');
  const st = useAsync(() => get(`/drives/${driveId}/pipeline`), [driveId], { skip: !driveId });
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Candidate pool" subtitle="Everyone in this drive and where they are." actions={<input className="input w-56" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />} />
          <Card pad={false}>
            <Async state={st} skeleton={<div className="skeleton m-5 h-64" />} isEmpty={(l) => !l.length} empty={<EmptyState icon={Users} title="No candidates yet" />}>
              {(rows) => <Table rows={rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))} rowKey="candidateId" columns={[
                { key: 'n', header: 'Candidate', render: (r) => <div className="flex items-center gap-3"><Avatar name={r.name} size={30} /><div><p className="font-semibold">{r.name}</p><p className="text-xs text-muted">{r.regNo}</p></div></div> },
                { key: 'b', header: 'Branch', render: (r) => r.branch || '—' },
                { key: 'st', header: 'Stage', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'r', header: 'Round', render: (r) => r.roundName || '—' },
              ]} />}
            </Async>
          </Card>
        </>
      )}
    </DriveGate>
  );
}

export function CompanySchedule() {
  const { driveId } = useDrive();
  const st = useAsync(() => get(`/drives/${driveId}/schedules`), [driveId], { skip: !driveId });
  return (
    <DriveGate>
      {(drive) => (
        <>
          <PageHeader title="Schedules" subtitle="Published interviews only. Candidates and panels are shown as scheduled." />
          <Card><Async state={st} skeleton={<div className="skeleton h-[540px]" />} isEmpty={(l) => !l.length} empty={<EmptyState icon={CalendarClock} title="Nothing published yet" text="You'll see interviews here once the coordinator publishes the schedule." />}>{(rows) => <ScheduleCalendar sessions={rows} timezone={drive.timezone} initialDate={drive.startDate} dayStart={drive.dayStart} dayEnd={drive.dayEnd} />}</Async></Card>
        </>
      )}
    </DriveGate>
  );
}

export function CompanyEvaluations() {
  const { driveId } = useDrive();
  const st = useAsync(() => get(`/drives/${driveId}/rankings`), [driveId], { skip: !driveId });
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Evaluation summaries" subtitle="Ranked weighted scores. Individual interviewer comments are never shared." />
          <Async state={st} isEmpty={(d) => !d.rows.length} empty={<Card><EmptyState icon={Trophy} title="No evaluation summaries yet" text="They appear once rounds are finalised – and only if the drive shares rankings with the company." /></Card>}>
            {(d) => (
              <Card pad={false}>
                <Table rows={d.rows} rowKey="candidateId" columns={[
                  { key: 'rank', header: 'Rank', className: 'w-16', render: (r) => <b>#{r.rank}</b> },
                  { key: 'n', header: 'Candidate', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.name} size={28} /><span className="font-semibold">{r.name}</span>{!r.final && <Badge tone="amber">Provisional</Badge>}</div> },
                  ...d.rounds.map((rd) => ({ key: rd.id, header: rd.name, className: 'text-center', render: (r) => { const x = r.rounds.find((y) => y.roundId === rd.id); return x ? Math.round(x.score) : '—'; } })),
                  { key: 'o', header: 'Overall', render: (r) => <div className="flex items-center gap-2"><b className="w-8">{Math.round(r.overall)}</b><div className="w-28"><Progress value={r.overall} tone={r.overall >= 60 ? 'ok' : 'amber'} /></div></div> },
                ]} />
                <p className="border-t border-line px-5 py-3 text-xs text-muted">{d.note}</p>
              </Card>
            )}
          </Async>
        </>
      )}
    </DriveGate>
  );
}

export function CompanyReports() {
  const { driveId } = useDrive();
  const toast = useToast();
  const st = useAsync(() => get(`/drives/${driveId}/reports/summary`), [driveId], { skip: !driveId });
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Reports" subtitle="Funnel and outcome statistics for this drive." actions={<Button icon={Download} variant="secondary" onClick={() => download(`/drives/${driveId}/reports/export`, 'recruitly-schedule.csv').catch((e) => toast.error(errMsg(e)))}>Export CSV</Button>} />
          <Async state={st} isEmpty={(d) => !d.byRound.length} empty={<Card><EmptyState icon={BarChart3} title="No data yet" /></Card>}>
            {(d) => (
              <div className="grid gap-6 xl:grid-cols-2">
                <Card title="Results by round"><div className="h-64"><ResponsiveContainer><BarChart data={d.byRound.map((r) => ({ name: r.name, Passed: r.passed, 'Not selected': r.failed, Scheduled: r.scheduled }))} margin={{ left: -16 }}><CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} axisLine={false} tickLine={false} /><Tooltip {...tip} /><Bar dataKey="Scheduled" fill="#3563E9" radius={[4, 4, 0, 0]} /><Bar dataKey="Passed" fill="#16865C" radius={[4, 4, 0, 0]} /><Bar dataKey="Not selected" fill="#D92D3A" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
                <Card title="Average score by round" pad={false}><Table rows={d.byRound} columns={[{ key: 'name', header: 'Round' }, { key: 'scheduled', header: 'Scheduled' }, { key: 'passed', header: 'Passed' }, { key: 'failed', header: 'Not selected' }, { key: 'avg', header: 'Avg score', render: (r) => (r.avgScore != null ? Math.round(r.avgScore) : '—') }]} /></Card>
              </div>
            )}
          </Async>
        </>
      )}
    </DriveGate>
  );
}

export function CompanyProfile() {
  const st = useAsync(() => get('/companies'), []);
  const [edit, setEdit] = useState(null);
  return (
    <>
      <PageHeader title="Company profile" subtitle="How your organisation appears to candidates and coordinators." />
      <Async state={st} isEmpty={(l) => !l.length} empty={<Card><EmptyState title="No company linked to your account" /></Card>}>
        {(list) => list.map((c) => (
          <Card key={c.id} title={c.name} action={<Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEdit(c)}>Edit</Button>}>
            <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="label">Industry</dt><dd>{c.industry || '—'}</dd></div><div><dt className="label">Location</dt><dd>{c.location || '—'}</dd></div><div><dt className="label">Website</dt><dd>{c.website || '—'}</dd></div><div><dt className="label">Drives</dt><dd>{c.drive_count}</dd></div><div className="sm:col-span-2"><dt className="label">About</dt><dd className="text-sm text-muted">{c.description || '—'}</dd></div></dl>
          </Card>
        ))}
      </Async>
      {edit && <CompanyForm company={edit} canKind={false} onClose={() => setEdit(null)} onSaved={() => st.reload({ silent: true })} />}
    </>
  );
}
void Link;
