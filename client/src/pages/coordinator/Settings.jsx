import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck2, Cpu, Mail, Moon, ShieldCheck, Sun, TestTube2 } from 'lucide-react';
import { get } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { Async, Badge, Button, Card, Note, PageHeader } from '../../components/ui';

function Row({ icon: Icon, title, ok, text, action, tone }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-0">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Icon size={20} /></span>
      <div className="min-w-0 flex-1"><p className="font-bold">{title}</p><p className="text-sm text-muted">{text}</p></div>
      <Badge tone={tone || (ok ? 'green' : 'amber')} dot>{ok ? 'Active' : 'Not configured'}</Badge>
      {action}
    </div>
  );
}

export default function Settings() {
  const st = useAsync(() => get('/settings/status'), []);
  const cal = useAsync(() => get('/calendar/status'), []);
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const c = params.get('calendar');
    if (c === 'connected') { toast.success('Google Calendar connected'); cal.reload({ silent: true }); }
    if (c === 'error') toast.error('Google Calendar could not be connected. Check the server log.');
    if (c) setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const connect = async () => { try { const r = await get('/calendar/google/connect'); window.location.href = r.url; } catch (e) { toast.error(e.userMessage); } };
  return (
    <>
      <PageHeader title="Settings" subtitle="Integration status is read live from the server. Recruitly never pretends an integration works when it isn't configured." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Integrations" pad={false}>
          <Async state={st} skeleton={<div className="skeleton m-5 h-56" />}>
            {(s) => (
              <>
                <Row icon={ShieldCheck} title="Google sign-in" ok={s.googleSignIn} text={s.googleSignIn ? 'Users can sign in with Google. New Google accounts are always candidates.' : 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.'} />
                <Row icon={CalendarCheck2} title="Google Calendar & Meet" ok={s.googleCalendar} text={s.googleCalendar ? (cal.data?.connected ? `Connected as ${cal.data.accountEmail}. Interviews create real events with Meet links.` : 'Enabled on the server. Connect a coordinator Google account to create events.') : 'Disabled. Interviews use a clearly labelled demo meeting link and no external calendar events are created.'}
                  action={s.googleCalendar && !cal.data?.connected ? <Button size="sm" onClick={connect}>Connect Google</Button> : null} />
                <Row icon={Mail} title="Email (SMTP)" ok={s.smtp} text={s.smtp ? 'Emails are delivered through your SMTP server.' : `Not configured – emails are recorded as “logged only” and never marked sent. Outbox: ${Object.entries(s.emailOutbox).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ') || 'empty'}.`} />
                <Row icon={TestTube2} title="Demo mode" ok={s.demoMode} tone={s.demoMode ? 'amber' : 'green'} text={s.demoMode ? 'Demo accounts and sample data are enabled. Turn off for production (DEMO_MODE=false). It is forced off when NODE_ENV=production.' : 'Off. No demo accounts can sign in.'} />
                <Row icon={Cpu} title="Scheduler budget" ok text={`The solver stops after ${s.schedulerBudget.maxMs} ms or ${s.schedulerBudget.maxNodes.toLocaleString()} search nodes and reports the best schedule found.`} />
              </>
            )}
          </Async>
        </Card>
        <div className="space-y-6">
          <Card title="Appearance">
            <p className="mb-3 text-sm text-muted">Choose how Recruitly looks on this device.</p>
            <div className="grid grid-cols-2 gap-2">
              {[['light', Sun, 'Light'], ['dark', Moon, 'Dark']].map(([k, I, l]) => <button key={k} onClick={() => theme !== k && toggle()} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold ${theme === k ? 'border-brand bg-brand/10 text-brand' : 'border-line hover:bg-soft'}`}><I size={16} />{l}</button>)}
            </div>
          </Card>
          <Note tone="info" title="Where do I add API keys?">All keys live in <code>backend/.env</code>. The frontend never needs secrets. See the README, section “API keys & integrations”, for step-by-step instructions.</Note>
        </div>
      </div>
    </>
  );
}
