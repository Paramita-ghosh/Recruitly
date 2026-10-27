import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { Async, Badge, Card, EmptyState, Note, PageHeader, Progress } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import { tip } from './Dashboard';
import { label } from '../../lib/utils';

const NAMES = { coverage: 'Coverage', loadBalance: 'Load balance', idleGaps: 'Idle gaps', candidatePreference: 'Candidate preference', modePreference: 'Mode preference', stability: 'Stability' };
const EXPLAIN = {
  coverage: 'Share of requested candidates that were scheduled.',
  loadBalance: 'How evenly interviews are spread across qualified interviewers.',
  idleGaps: 'Short waits between an interviewer’s consecutive interviews.',
  candidatePreference: 'Candidates placed in a window they marked as preferred.',
  modePreference: 'Interviews run in each panelist’s preferred mode.',
  stability: 'Share of previously published interviews left untouched.',
};
const col = (s) => (s >= 80 ? '#16865C' : s >= 55 ? '#3563E9' : s >= 35 ? '#F4B942' : '#D92D3A');

export default function Quality() {
  const { driveId, rounds } = useDrive();
  const [roundId, setRoundId] = useState('');
  const st = useAsync(() => get(`/drives/${driveId}/schedules/quality`, roundId ? { roundId } : undefined), [driveId, roundId], { skip: !driveId });
  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Quality report" subtitle="A transparent 0–100 score. Hard constraints are verified independently; any violation forces the score to 0."
            actions={<select className="input w-auto" value={roundId} onChange={(e) => setRoundId(e.target.value)} aria-label="Round"><option value="">Latest run</option>{rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>} />
          <Async state={st} isEmpty={(d) => !d.quality} empty={<Card><EmptyState title="No schedule to score" text="Generate a schedule first." /></Card>}>
            {(d) => {
              const q = d.quality;
              const comps = Object.entries(q.components).map(([k, v]) => ({ key: k, name: NAMES[k] || label(k), ...v }));
              return (
                <div className="space-y-6">
                  <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
                    <Card>
                      <div className="text-center">
                        <div className="relative mx-auto grid h-44 w-44 place-items-center rounded-full" style={{ background: `conic-gradient(${q.valid ? col(q.score) : '#D92D3A'} ${q.score * 3.6}deg, rgb(var(--soft)) 0)` }}>
                          <div className="grid h-36 w-36 place-items-center rounded-full bg-card"><div><p className="text-5xl font-extrabold">{Math.round(q.score)}</p><p className="text-xs font-semibold text-muted">out of 100</p></div></div>
                        </div>
                        <div className="mt-5">{q.valid ? <Badge tone="green" dot>Hard constraints verified</Badge> : <Badge tone="red" dot>{q.hardConstraintViolations} violation(s)</Badge>}</div>
                        <p className="mt-3 text-xs text-muted">{q.note}</p>
                        <p className="mt-2 text-xs text-muted">{d.sessions} interviews in this schedule</p>
                      </div>
                    </Card>
                    <Card title="Score breakdown" subtitle="Weighted contribution of each component">
                      <div className="h-60"><ResponsiveContainer><BarChart data={comps.map((c) => ({ name: c.name, Score: c.score, w: c.weight }))} layout="vertical" margin={{ left: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" horizontal={false} /><XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} axisLine={false} tickLine={false} /><YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 12, fill: 'rgb(var(--text))' }} axisLine={false} tickLine={false} />
                        <Tooltip {...tip} formatter={(v, _n, p) => [`${v} / 100 (weight ${p.payload.w})`, 'Score']} />
                        <Bar dataKey="Score" radius={[0, 6, 6, 0]} barSize={16}>{comps.map((c) => <Cell key={c.key} fill={col(c.score)} />)}</Bar>
                      </BarChart></ResponsiveContainer></div>
                    </Card>
                  </div>
                  <Card title="What each component means" pad={false}>
                    <ul className="divide-y divide-line">
                      {comps.map((c) => (
                        <li key={c.key} className="grid items-center gap-3 px-5 py-4 md:grid-cols-[220px_1fr_90px]">
                          <div><p className="font-bold">{c.name} <span className="text-xs font-medium text-muted">· weight {c.weight}</span></p><p className="text-xs text-muted">{EXPLAIN[c.key]}</p></div>
                          <div><Progress value={c.score} tone={c.score >= 80 ? 'ok' : c.score >= 55 ? 'brand' : c.score >= 35 ? 'amber' : 'bad'} /><p className="mt-1 text-xs text-muted">{c.detail}</p></div>
                          <p className="text-right text-lg font-extrabold">{Math.round(c.score)}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                  {q.violations?.length > 0 ? (
                    <Note tone="error" title="Hard-constraint violations"><ul className="mt-1 list-disc space-y-1 pl-5">{q.violations.map((v, i) => <li key={i}>{v.message}</li>)}</ul></Note>
                  ) : <Note tone="ok" title="No hard-constraint violations"><span className="flex items-center gap-2"><CheckCircle2 size={15} />Availability, skills, capacity, rooms and overlaps all verified.</span></Note>}
                  {d.lastRun && <p className="text-xs text-muted">Last run: {label(d.lastRun.status)} · solved in {d.lastRun.stats?.elapsedMs} ms · {d.lastRun.stats?.scheduled}/{d.lastRun.stats?.requested} scheduled.</p>}
                </div>
              );
            }}
          </Async>
        </>
      )}
    </DriveGate>
  );
}
void ShieldAlert;
