import { useEffect, useState } from 'react';
import { EyeOff, Lock, Play, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { get, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useToast } from '../../context/ToastContext';
import { Async, Badge, Button, Card, Field, Note, Progress } from '../ui';
import { cn, fmtDateTime, label } from '../../lib/utils';

const RECS = [['strong_yes', 'Strong yes'], ['yes', 'Yes'], ['no', 'No'], ['strong_no', 'Strong no']];

function ScoreButtons({ min, max, value, onChange, disabled }) {
  const opts = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {opts.map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} disabled={disabled} onClick={() => onChange(n)}
          className={cn('h-10 w-10 rounded-lg border text-sm font-bold transition', value === n ? 'border-brand bg-brand text-white shadow' : 'border-line bg-card hover:border-brand hover:bg-brand/5', disabled && 'cursor-not-allowed opacity-60')}>{n}</button>
      ))}
    </div>
  );
}


export default function EvaluationPanel({ sessionId, role, onDone }) {
  const toast = useToast();
  const st = useAsync(() => get(`/interviews/${sessionId}/evaluation`), [sessionId]);
  const [scores, setScores] = useState({});
  const [comments, setComments] = useState('');
  const [rec, setRec] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const d = st.data;

  useEffect(() => {
    if (!d?.mine) return;
    setScores(Object.fromEntries(d.mine.scores.map((s) => [s.criterionId, s.score])));
    setComments(d.mine.comments || ''); setRec(d.mine.recommendation || '');
  }, [d?.mine?.id]); 

  const submit = async () => {
    setError('');
    const crit = d.rubric.criteria;
    const missing = crit.filter((c) => scores[c.id] == null);
    if (missing.length) return setError(`Please score: ${missing.map((m) => m.name).join(', ')}`);
    setBusy(true);
    try {
      await post(`/interviews/${sessionId}/evaluation`, { scores: crit.map((c) => ({ criterionId: c.id, score: scores[c.id] })), comments: comments || undefined, recommendation: rec || undefined });
      toast.success('Evaluation submitted');
      await st.reload({ silent: true }); onDone?.();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const start = async () => { try { await post(`/interviews/${sessionId}/start`); toast.success('Interview marked as started'); st.reload({ silent: true }); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <Async state={st}>
      {(v) => {
        const crit = v.rubric.criteria;
        const submitted = !!v.mine;
        const interviewer = role === 'interviewer';
        const weighted = (list) => Math.round((list.reduce((a, s) => { const c = crit.find((x) => x.id === s.criterionId); return a + (c ? ((s.score - v.rubric.scaleMin) / (v.rubric.scaleMax - v.rubric.scaleMin)) * c.weight : 0); }, 0) / crit.reduce((a, c) => a + c.weight, 0)) * 100);
        const liveScore = crit.every((c) => scores[c.id] != null) ? weighted(Object.entries(scores).map(([criterionId, score]) => ({ criterionId, score }))) : null;
        return (
          <div className="space-y-5">
            <Card title={`${v.session.candidateName} · ${v.session.roundName}`} subtitle={`${fmtDateTime(v.session.startsAt)} · ${label(v.session.mode)}`}
              action={<div className="flex items-center gap-2"><Badge tone="blue">{v.panel.submitted} of {v.panel.size} panelists submitted</Badge>
              {v.result && <Badge tone={v.result.status === 'passed' ? 'green' : v.result.status === 'failed' ? 'red' : 'gray'}>{label(v.result.status)}</Badge>}</div>}>
              {v.blinded && <Note tone="info" title={<span className="flex items-center gap-2"><EyeOff size={15} />Evaluation is blinded</span>}>{v.blindedNote || 'Other panelists’ scores and comments stay hidden until every panelist has submitted.'}</Note>}
              {v.result?.finalScore != null && <div className="mt-4 flex items-center gap-4"><div className="text-3xl font-extrabold text-brand">{Math.round(v.result.finalScore)}</div><div className="flex-1"><Progress value={v.result.finalScore} tone={v.result.finalScore >= 60 ? 'ok' : 'amber'} /><p className="mt-1 text-xs text-muted">Weighted average across the panel (0–100)</p></div></div>}
            </Card>

            {interviewer && (
              <Card title={submitted ? 'Your submitted evaluation' : 'Your evaluation'} subtitle={`Rate each criterion from ${v.rubric.scaleMin} (weak) to ${v.rubric.scaleMax} (outstanding).`}
                action={v.session.status === 'scheduled' && !submitted ? <Button size="sm" variant="secondary" icon={Play} onClick={start}>Mark started</Button> : null}>
                {!v.canSubmit && !submitted && <Note tone="warn" title={<span className="flex items-center gap-2"><Lock size={15} />Evaluation not open</span>}>You can evaluate once the interview has started or finished. Ask the coordinator if this looks wrong.</Note>}
                <div className="space-y-5">
                  {crit.map((c) => (
                    <div key={c.id} className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
                      <div><p className="text-sm font-bold">{c.name} <span className="text-xs font-medium text-muted">· {c.weight}%</span></p>{c.description && <p className="text-xs text-muted">{c.description}</p>}</div>
                      <ScoreButtons min={v.rubric.scaleMin} max={v.rubric.scaleMax} value={scores[c.id]} onChange={(n) => setScores((s) => ({ ...s, [c.id]: n }))} disabled={!v.canSubmit} />
                    </div>
                  ))}
                  <Field label="Recommendation"><div className="flex flex-wrap gap-2">{RECS.map(([k, l]) => <button key={k} type="button" disabled={!v.canSubmit} onClick={() => setRec(k)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold', rec === k ? (k.includes('no') ? 'border-bad bg-bad text-white' : 'border-ok bg-ok text-white') : 'border-line hover:bg-soft')}>{k.includes('no') ? <ThumbsDown size={13} /> : <ThumbsUp size={13} />}{l}</button>)}</div></Field>
                  <Field label="Private comments" hint="Only coordinators see comments, and only after the panel is complete."><textarea className="input min-h-24" maxLength={3000} value={comments} onChange={(e) => setComments(e.target.value)} disabled={!v.canSubmit} /></Field>
                  {error && <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted">{liveScore != null ? <>Your weighted score: <b className="text-ink">{liveScore}/100</b></> : 'Score every criterion to see your weighted score.'}</p>
                    <Button icon={Send} loading={busy} disabled={!v.canSubmit} onClick={submit}>{submitted ? 'Update evaluation' : 'Submit evaluation'}</Button>
                  </div>
                </div>
              </Card>
            )}

            {v.others && v.others.length > 0 && (
              <Card title="Panel evaluations" subtitle="Visible because the panel is complete.">
                <div className="space-y-4">
                  {v.others.map((o) => (
                    <div key={o.id} className="rounded-xl border border-line p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{o.interviewerName}</p><div className="flex items-center gap-2">{o.recommendation && <Badge tone={o.recommendation.includes('no') ? 'red' : 'green'}>{label(o.recommendation)}</Badge>}<Badge tone="blue">{Math.round(o.weightedScore)}/100</Badge></div></div>
                      <div className="grid gap-2 sm:grid-cols-2">{o.scores.map((s) => <div key={s.criterionId} className="flex items-center justify-between rounded-lg bg-soft px-3 py-2 text-sm"><span>{crit.find((c) => c.id === s.criterionId)?.name}</span><b>{s.score}</b></div>)}</div>
                      {o.comments && <p className="mt-3 text-sm text-muted">“{o.comments}”</p>}
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {!interviewer && v.others && v.others.length === 0 && <Note tone="info">No evaluations have been submitted yet.</Note>}
            {!interviewer && v.blinded && <Note tone="warn" title="Hidden from everyone, including you">Coordinators also cannot see individual scores until the panel is complete. This keeps evaluation independent.</Note>}
          </div>
        );
      }}
    </Async>
  );
}
