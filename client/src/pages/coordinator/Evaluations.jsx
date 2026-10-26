import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Download, Trophy, X } from 'lucide-react';
import { get, post, download, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Async, Avatar, Badge, Button, Card, EmptyState, Field, Modal, Note, PageHeader, Progress, Table } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import EvaluationPanel from '../../components/shared/EvaluationPanel';
import { label } from '../../lib/utils';

const scoreTone = (s) => (s >= 75 ? 'text-ok' : s >= 55 ? 'text-brand' : 'text-bad');

export default function Evaluations() {
  const { driveId, rounds, drive } = useDrive();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('session');
  const rank = useAsync(() => get(`/drives/${driveId}/rankings`), [driveId], { skip: !driveId });
  const review = useAsync(() => get(`/drives/${driveId}/schedules`), [driveId], { skip: !driveId });
  const [decide, setDecide] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => { rank.reload({ silent: true }); review.reload({ silent: true }); };

  const finalize = async (decision) => {
    setBusy(true);
    try { await post(`/interviews/${decide.id}/result`, { decision, note: note || undefined }); toast.success(`${decide.candidateName} marked ${decision === 'pass' ? 'passed' : 'not selected'}`); setDecide(null); setNote(''); refresh(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const awaiting = (review.data || []).filter((s) => s.resultStatus === 'pending' && s.finalScore != null);

  return (
    <DriveGate>
      {() => (
        <>
          <PageHeader title="Evaluation matrix" subtitle="Weighted 0–100 scores per round, ranked. Scores are released only after every panelist has submitted."
            actions={<Button variant="secondary" icon={Download} onClick={() => download(`/drives/${driveId}/reports/export`, 'recruitly-schedule.csv').catch((e) => toast.error(errMsg(e)))}>Export CSV</Button>} />

          {awaiting.length > 0 && (
            <Card className="mb-6" title="Awaiting your decision" subtitle="Panels are complete and the round requires a coordinator review." pad={false}>
              <Table rows={awaiting} columns={[
                { key: 'n', header: 'Candidate', render: (s) => <div className="flex items-center gap-2"><Avatar name={s.candidateName} size={28} /><b>{s.candidateName}</b></div> },
                { key: 'r', header: 'Round', render: (s) => s.roundName },
                { key: 'sc', header: 'Score', render: (s) => <b className={scoreTone(s.finalScore)}>{Math.round(s.finalScore)}</b> },
                { key: 'a', header: '', className: 'text-right', render: (s) => <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setParams({ session: s.id })}>Details</Button><Button size="sm" onClick={() => setDecide(s)}>Decide</Button></div> },
              ]} />
            </Card>
          )}

          <Async state={rank} isEmpty={(d) => !d.rows.length} empty={<Card><EmptyState icon={Trophy} title="No scores yet" text="Scores appear here once interviewers submit evaluations." /></Card>}>
            {(d) => (
              <Card pad={false}>
                <div className="scroll-thin overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse">
                    <thead><tr className="border-b border-line bg-soft/60"><th className="th w-14">Rank</th><th className="th">Candidate</th>{d.rounds.map((r) => <th key={r.id} className="th text-center">{r.name}</th>)}<th className="th w-56">Overall</th></tr></thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.candidateId} className="border-b border-line/70 last:border-0 hover:bg-soft/40">
                          <td className="td"><span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold ${r.rank <= 3 ? 'bg-amber/25 text-[#8A5F00]' : 'bg-soft text-muted'}`}>{r.rank}</span></td>
                          <td className="td"><div className="flex items-center gap-2.5"><Avatar name={r.name} size={30} /><div><p className="font-semibold">{r.name}</p>{!r.final && <Badge tone="amber">Provisional</Badge>}</div></div></td>
                          {d.rounds.map((rd) => {
                            const x = r.rounds.find((y) => y.roundId === rd.id);
                            return <td key={rd.id} className="td text-center">{x ? <button className="inline-flex flex-col items-center" onClick={() => setParams({ session: x.sessionId })}><b className={scoreTone(x.score)}>{Math.round(x.score)}</b><span className="text-[10px] text-muted">{x.result === 'pending' ? 'pending' : label(x.result)}</span></button> : <span className="text-muted">—</span>}</td>;
                          })}
                          <td className="td"><div className="flex items-center gap-3"><b className="w-9 text-right">{Math.round(r.overall)}</b><div className="flex-1"><Progress value={r.overall} tone={r.overall >= 60 ? 'ok' : 'amber'} /></div></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-line px-5 py-3 text-xs text-muted">{d.note}</p>
              </Card>
            )}
          </Async>
          {drive && <p className="mt-3 text-xs text-muted">Rounds: {rounds.map((r) => `${r.name} (pass ≥ ${r.passThreshold})`).join(' · ')}</p>}

          <Modal open={!!sessionId} onClose={() => setParams({})} title="Evaluation details" size="lg">{sessionId && <EvaluationPanel sessionId={sessionId} role="coordinator" onDone={refresh} />}</Modal>
          <Modal open={!!decide} onClose={() => setDecide(null)} title={`Decide: ${decide?.candidateName}`} size="sm"
            footer={<><Button variant="danger" icon={X} loading={busy} onClick={() => finalize('fail')}>Not selected</Button><Button icon={Check} loading={busy} onClick={() => finalize('pass')}>Pass &amp; advance</Button></>}>
            <Note tone="info">Weighted score {decide && Math.round(decide.finalScore)}. A pass moves the candidate to the next round automatically.</Note>
            <Field className="mt-4" label="Note (optional)"><textarea className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </Modal>
        </>
      )}
    </DriveGate>
  );
}
