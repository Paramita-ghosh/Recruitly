import { Check, Circle, Clock, X } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { Async, Card, EmptyState, PageHeader } from '../../components/ui';
import { fmtDateTime, label } from '../../lib/utils';
import { Link } from 'react-router-dom';

export default function CandidateProgress() {
  const dash = useAsync(() => get('/dashboard'), []);
  const iv = useAsync(() => get('/interviews', { scope: 'all' }), []);
  return (
    <>
      <PageHeader title="Pipeline progress" subtitle="Where you are in each recruitment process. Results appear once the coordinator publishes them." />
      <Async state={dash} isEmpty={(d) => !d.drives.length} empty={<Card><EmptyState title="No drives yet" /></Card>}>
        {(d) => (
          <div className="space-y-6">
            {d.drives.map((dr) => {
              const mine = (iv.data || []).filter((s) => s.driveId === dr.id);
              const rounds = Array.from({ length: dr.totalRounds }, (_, i) => i + 1);
              return (
                <Card key={dr.id} title={dr.name} subtitle={dr.companyName}>
                  <ol className="grid gap-4 md:grid-cols-3">
                    {rounds.map((n) => {
                      const s = mine.find((x) => x.roundPosition === n);
                      const done = s?.status === 'completed';
                      const failed = s?.resultStatus === 'failed' && s.resultPublished;
                      const passed = s?.resultStatus === 'passed' && s.resultPublished;
                      const I = failed ? X : passed || done ? Check : s ? Clock : Circle;
                      const tone = failed ? 'bg-bad text-white' : passed ? 'bg-ok text-white' : s ? 'bg-brand text-white' : 'bg-soft text-muted';
                      return (
                        <li key={n} className="rounded-xl border border-line p-4">
                          <div className="flex items-center gap-3"><span className={`grid h-9 w-9 place-items-center rounded-full ${tone}`}><I size={17} /></span><div><p className="text-xs font-semibold uppercase text-muted">Round {n}</p><p className="font-bold">{s?.roundName || (n === dr.totalRounds ? 'Final round' : `Round ${n}`)}</p></div></div>
                          <p className="mt-3 text-sm text-muted">{s ? (<>{fmtDateTime(s.startsAt, s.timezone)}<br />{failed ? 'Not selected for the next stage' : passed ? 'Cleared – well done!' : label(s.status)}</>) : 'Not scheduled yet'}</p>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="mt-4 text-xs text-muted">Current stage: <b className="text-ink">{label(dr.status)}</b>. <Link to="/candidate/interviews" className="font-semibold text-brand hover:underline">View interviews</Link></p>
                </Card>
              );
            })}
          </div>
        )}
      </Async>
    </>
  );
}
