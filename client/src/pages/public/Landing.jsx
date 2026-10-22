import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarCheck2, CalendarClock, CheckCircle2, ClipboardCheck, Cpu, DoorOpen, Layers, Link2, RefreshCcw, ShieldCheck, Users, Video, Zap } from 'lucide-react';
import Logo from '../../components/layout/Logo';
import { useAuth, HOME } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Moon, Sun } from 'lucide-react';

const FEATURES = [
  { icon: Cpu, t: 'Constraint-based scheduler', d: 'Hard constraints (availability, skills, rooms, capacity) are never broken. Soft goals — balance, short gaps, preferences — are optimised and scored 0–100.', c: 'bg-brand/10 text-brand' },
  { icon: Link2, t: 'One-click self-booking', d: 'Candidates pick from slots that are genuinely free. Concurrent bookings are race-safe: exactly one wins, the rest are told politely.', c: 'bg-teal/10 text-teal' },
  { icon: RefreshCcw, t: 'Minimal-disruption rescheduling', d: 'An interviewer drops out? Recruitly previews the smallest set of changes, explains each one, and applies them only after you approve.', c: 'bg-violet/10 text-violet' },
  { icon: Layers, t: 'Multi-stage pipelines', d: 'Coding → Technical → HR. Candidates who pass advance automatically; everyone else is told and the pipeline stays accurate.', c: 'bg-amber/20 text-[#9A6B00]' },
  { icon: ClipboardCheck, t: 'Blinded evaluations', d: 'Panelists score against weighted rubrics without seeing each other. Results unlock only when everyone has submitted — enforced server-side.', c: 'bg-brand/10 text-brand' },
  { icon: DoorOpen, t: 'Rooms & online modes', d: 'Offline rooms with capacity and equipment, online interviews with calendar links, and per-interviewer mode preferences.', c: 'bg-teal/10 text-teal' },
];
const ROLES = [
  { icon: CalendarCheck2, t: 'Coordinators', d: 'Generate, validate, publish and repair schedules with a full audit trail.' },
  { icon: Video, t: 'Interviewers', d: 'Set availability once, see your day, submit structured evaluations.' },
  { icon: Users, t: 'Candidates', d: 'Share availability, book a slot, add it to your calendar, follow your progress.' },
  { icon: BarChart3, t: 'Hiring teams', d: 'Follow the funnel, compare candidates and download reports.' },
];

function MockCalendar() {
  const rows = [['bg-brand', 'Aanya · Coding', 'Meera'], ['bg-violet', 'Rohit · Technical', 'Sana + Rohan'], ['bg-teal', 'Ishaan · Coding', 'Arjun'], ['bg-amber', 'Diya · HR', 'Nisha']];
  return (
    <div className="card relative w-full max-w-lg overflow-hidden p-5 shadow-pop">
      <div className="mb-4 flex items-center justify-between"><p className="text-sm font-bold">Thursday, 22 Oct</p><span className="rounded-full bg-ok/10 px-2.5 py-1 text-xs font-bold text-ok">Quality 92 / 100</span></div>
      <div className="space-y-2.5">
        {rows.map(([c, a, b], i) => (
          <div key={a} className="flex items-center gap-3 rounded-lg border border-line p-2.5" style={{ marginLeft: `${(i % 2) * 18}px` }}>
            <span className={`h-9 w-1.5 rounded-full ${c}`} />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{a}</p><p className="text-xs text-muted">{b}</p></div>
            <span className="text-xs font-semibold text-muted">{9 + i}:{i % 2 ? '30' : '00'}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-ok/10 p-3 text-xs font-semibold text-ok"><CheckCircle2 size={16} />0 hard-constraint violations · independently verified</div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-30 border-b border-line bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm font-semibold text-muted md:flex"><a href="#features" className="hover:text-ink">Features</a><a href="#how" className="hover:text-ink">How it works</a><a href="#roles" className="hover:text-ink">Who it's for</a></nav>
          <div className="flex items-center gap-2">
            <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-soft" aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
            {user ? <Link to={HOME[user.role]} className="btn-primary">Open dashboard</Link> : (<><Link to="/login" className="btn-ghost hidden sm:inline-flex">Sign in</Link><Link to="/register" className="btn-primary">Get started</Link></>)}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-r from-brand/20 via-violet/15 to-teal/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 lg:grid-cols-[1.1fr_1fr] lg:py-28">
          <div className="animate-fadeUp">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-bold text-brand"><Zap size={13} />Built for campus drives and hiring teams</span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-ink sm:text-6xl">Interview Scheduling, <span className="bg-gradient-to-r from-brand via-violet to-teal bg-clip-text text-transparent">Without the Chaos.</span></h1>
            <p className="mt-6 max-w-xl text-lg text-muted">Recruitly turns hundreds of candidates, a handful of interviewers and a few rooms into a clean, conflict-free schedule — then keeps it that way when plans change.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={user ? HOME[user.role] : '/register'} className="btn-primary px-6 py-3">{user ? 'Open dashboard' : 'Create candidate account'}<ArrowRight size={16} /></Link>
              <Link to="/login" className="btn-secondary px-6 py-3">Try the live demo</Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">{['No double-bookings, ever', 'Explains every conflict', 'Role-based & audited'].map((t) => <span key={t} className="flex items-center gap-1.5"><CheckCircle2 size={15} className="text-ok" />{t}</span>)}</div>
          </div>
          <div className="flex justify-center lg:justify-end"><MockCalendar /></div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center"><p className="text-xs font-bold uppercase tracking-widest text-brand">Features</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight">Everything between "applied" and "offered"</h2><p className="mt-3 text-muted">One platform for availability, scheduling, booking, evaluation and reporting.</p></div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.t} className="card p-6 transition hover:-translate-y-0.5 hover:shadow-pop">
              <div className={`mb-4 grid h-11 w-11 place-items-center rounded-xl ${f.c}`}><f.icon size={22} /></div>
              <h3 className="text-base font-bold">{f.t}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="bg-navy py-20 text-white">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center"><p className="text-xs font-bold uppercase tracking-widest text-[#7FA2FF]">How it works</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight">From chaos to calendar in four steps</h2></div>
          <div className="mt-12 grid gap-5 md:grid-cols-4">
            {[['1', 'Collect availability', 'Candidates and interviewers paint their free time on a weekly grid.'], ['2', 'Generate', 'The solver builds a schedule and proves what it can and cannot place.'], ['3', 'Review & publish', 'Check the quality score, fix conflicts, publish with one click.'], ['4', 'Evaluate & advance', 'Blinded scoring decides who moves to the next round automatically.']].map(([n, t, d]) => (
              <div key={n} className="rounded-2xl border border-white/10 bg-white/5 p-6"><span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-extrabold">{n}</span><h3 className="mt-4 font-bold">{t}</h3><p className="mt-2 text-sm text-white/65">{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center"><p className="text-xs font-bold uppercase tracking-widest text-brand">Who it's for</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight">A tailored workspace for every role</h2></div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => <div key={r.t} className="card p-6 text-center"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand to-violet text-white"><r.icon size={22} /></div><h3 className="font-bold">{r.t}</h3><p className="mt-2 text-sm text-muted">{r.d}</p></div>)}
        </div>
        <div className="mt-16 overflow-hidden rounded-3xl bg-gradient-to-r from-brand to-violet p-10 text-center text-white shadow-pop">
          <ShieldCheck className="mx-auto mb-3" size={30} />
          <h3 className="text-2xl font-extrabold">Ready to bring order to your interview days?</h3>
          <p className="mx-auto mt-2 max-w-xl text-white/80">Explore the demo workspace with sample data, or create a candidate account to book an interview.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3"><Link to="/login" className="btn bg-white text-brand hover:bg-white/90">Open the demo</Link><Link to="/register" className="btn border border-white/40 text-white hover:bg-white/10">Create account</Link></div>
        </div>
      </section>
      <footer className="border-t border-line py-8"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 text-sm text-muted"><Logo size={24} /><p>© {new Date().getFullYear()} Recruitly. Interview scheduling, without the chaos.</p></div></footer>
    </div>
  );
}
