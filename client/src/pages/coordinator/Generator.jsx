import { useState } from 'react';
import { CheckCircle2, Link2, Megaphone, Play, ShieldCheck, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get, post, errMsg } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Async, Badge, Button, Card, Confirm, EmptyState, Note, PageHeader, Stat, Table } from '../../components/ui';
import DriveGate from '../../components/shared/DriveGate';
import { fmtDateTime, label } from '../../lib/utils';
import { CalendarCheck2, Gauge, Layers, Timer } from 'lucide-react';

const TONE = { complete: 'green', partial: 'amber', infeasible: 'red', budget_exhausted: 'amber' };
const STATUS_TEXT = {
  complete: 'Every candidate was scheduled.',
  partial: 'Some candidates could not be scheduled. Each one has an explanation under “Unscheduled & conflicts”.',
  infeasible: 'No candidate could be scheduled with the current constraints.',
  budget_exhausted: 'The search budget ran out before every option was explored; the result is the best schedule found.',
};

export default function Generator() {
  const { driveId, reloadDetail, reload } = useDrive();
  const toast = useToast();
  const [roundId, setRoundId] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [validation, setValidation] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const runs = useAsync(() => get(`/drives/${driveId}/schedule-runs`), [driveId], { skip: !driveId });

  const act = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast.success(typeof ok === 'function' ? ok(r) : ok); return r; } catch (e) { toast.error(errMsg(e)); return null; } finally { setBusy(''); }
  };
  const generate = async (rid) => {
    const r = await act('gen', () => post(`/drives/${driveId}/schedules/generate`, rid ? { roundId: rid } : {}), (x) => `Scheduled ${x.scheduledCount} interviews`);
    if (r) { setResult(r); setValidation(null); runs.reload({ silent: true }); reloadDetail(); }
  };
  const validate = async () => { const r = await act('val', () => post(`/drives/${driveId}/schedules/validate`), null); if (r) setValidation(r); };
  const publish = async () => { setConfirm(null); const r = await act('pub', () => post(`/drives/${driveId}/schedules/publish`), (x) => `Published ${x.published} interviews. Candidates and interviewers were notified.`); if (r) { reload(); reloadDetail(); } };
  const publishResults = async () => { setConfirm(null); await act('res', () => post(`/drives/${driveId}/results/publish`), (x) => `Published ${x.published ?? x.count ?? ''} results`); };
  const links = async (rid) => { const r = await act('links', () => post(`/drives/${driveId}/booking-links`, { roundId: rid }), (x) => `${x.issued} booking invitations prepared`); return r; };

  return (
    <DriveGate>
      {(drive) => (
        <>
          <PageHeader title="Schedule generator" subtitle="Generate a round at a time, validate independently, then publish. Nothing is shown to candidates or interviewers until you publish."
            actions={<><Button variant="secondary" icon={ShieldCheck} loading={busy === 'val'} onClick={validate}>Validate schedule</Button><Button icon={Megaphone} loading={busy === 'pub'} onClick={() => setConfirm('pub')}>Publish schedule</Button></>} />

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="1 · Generate" subtitle="The solver places candidates round by round. Existing completed and published interviews are respected." className="xl:col-span-2">
              <div className="space-y-3">
                {drive.rounds.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-sm font-extrabold text-brand">{r.position}</span>
                    <div className="min-w-0 flex-1"><p className="font-bold">{r.name}</p><p className="text-xs text-muted">{r.durationMinutes} min · panel of {r.panelSize} · {r.allowedModes.join(' / ')} · booking: {label(r.bookingPolicy)}</p></div>
                    <Button size="sm" variant="secondary" icon={Link2} loading={busy === 'links'} onClick={() => links(r.id)} title="Issue self-booking links to candidates awaiting this round">Booking links</Button>
                    <Button size="sm" icon={Play} loading={busy === 'gen' && roundId === r.id} onClick={() => { setRoundId(r.id); generate(r.id); }}>Generate</Button>
                  </div>
                ))}
                {drive.rounds.length === 0 && <EmptyState icon={Layers} title="No rounds configured" text="Add at least one round before generating." action={<Link to="/coordinator/rounds" className="btn-primary">Configure rounds</Link>} />}
              </div>
            </Card>
            <Card title="2 · Review & release" subtitle="Quality gates before candidates see anything.">
              <ol className="space-y-4 text-sm">
                <li className="flex gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" /><span><b>Validate</b> re-checks every hard constraint from scratch, independently of the solver.</span></li>
                <li className="flex gap-3"><Megaphone size={18} className="mt-0.5 shrink-0 text-brand" /><span><b>Publish</b> makes interviews visible and sends notifications. Blocked if any hard constraint is violated.</span></li>
                <li className="flex gap-3"><Trophy size={18} className="mt-0.5 shrink-0 text-violet" /><span><b>Publish results</b> after evaluation so candidates can see their outcome.</span></li>
              </ol>
              <Button className="mt-5 w-full" variant="secondary" loading={busy === 'res'} onClick={() => setConfirm('res')}>Publish evaluation results</Button>
            </Card>
          </div>

          {validation && (
            <div className="mt-6"><Note tone={validation.valid ? 'ok' : 'error'} title={validation.valid ? `Valid — ${validation.checked} interviews checked, 0 violations` : `${validation.violations.length} hard-constraint violation(s)`}>
              {validation.valid ? 'Every interview satisfies availability, skills, capacity, rooms and overlap rules.' : <ul className="mt-1 list-disc space-y-1 pl-5">{validation.violations.slice(0, 8).map((v, i) => <li key={i}>{v.message}</li>)}</ul>}
            </Note></div>
          )}

          {result && (
            <div className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Scheduled" value={result.scheduledCount} icon={CalendarCheck2} tone="green" hint={`of ${result.stats.requested} requested`} />
                <Stat label="Unscheduled" value={result.unscheduled.length} icon={Layers} tone={result.unscheduled.length ? 'amber' : 'green'} />
                <Stat label="Quality score" value={`${Math.round(result.quality.score)}/100`} icon={Gauge} tone="blue" hint={result.quality.valid ? 'All hard constraints verified' : 'Violations present'} />
                <Stat label="Solve time" value={`${result.stats.elapsedMs} ms`} icon={Timer} tone="violet" hint={`${result.stats.nodes} search nodes`} />
              </div>
              <Note tone={TONE[result.status] === 'green' ? 'ok' : TONE[result.status] === 'red' ? 'error' : 'warn'} title={`Solver status: ${label(result.status)}`}>{STATUS_TEXT[result.status]}</Note>
              {result.warnings?.length > 0 && <Note tone="warn" title="Configuration warnings"><ul className="list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{typeof w === 'string' ? w : w.message}</li>)}</ul></Note>}
              {result.unscheduled.length > 0 && <Link to="/coordinator/unscheduled" className="btn-secondary">See why {result.unscheduled.length} candidate(s) were not scheduled</Link>}
            </div>
          )}

          <Card className="mt-6" title="Generation history" pad={false}>
            <Async state={runs} skeleton={<div className="skeleton m-5 h-32" />} isEmpty={(r) => r.length === 0} empty={<EmptyState title="No runs yet" text="Generate a round to start the history." />}>
              {(rows) => <Table rows={rows} columns={[
                { key: 'created_at', header: 'When', render: (r) => fmtDateTime(r.created_at, drive.timezone) },
                { key: 'round', header: 'Round', render: (r) => drive.rounds.find((x) => x.id === r.round_id)?.name || '—' },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={TONE[r.status]} dot>{label(r.status)}</Badge> },
                { key: 'sched', header: 'Scheduled', render: (r) => `${r.stats?.scheduled ?? '—'} / ${r.stats?.requested ?? '—'}` },
                { key: 'score', header: 'Score', render: (r) => (r.quality ? Math.round(r.quality.score) : '—') },
                { key: 'ms', header: 'Time', render: (r) => `${r.stats?.elapsedMs ?? '—'} ms` },
              ]} />}
            </Async>
          </Card>

          <Confirm open={confirm === 'pub'} title="Publish this schedule?" confirmLabel="Publish and notify" onClose={() => setConfirm(null)} onConfirm={publish}
            text="Interviews become visible to candidates, interviewers and the company, and notifications are queued. If SMTP is not configured, emails are recorded as “logged only” – never marked as sent." />
          <Confirm open={confirm === 'res'} title="Publish evaluation results?" confirmLabel="Publish results" onClose={() => setConfirm(null)} onConfirm={publishResults}
            text="Candidates will see pass / not selected for every finalised interview. This cannot be undone." />
        </>
      )}
    </DriveGate>
  );
}
