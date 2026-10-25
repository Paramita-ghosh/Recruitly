import { Link } from 'react-router-dom';
import { CalendarCheck2, ShieldCheck, Sparkles } from 'lucide-react';
import Logo from '../../components/layout/Logo';

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-navy p-12 text-on-navy lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-violet/15 blur-3xl" />
        <Link to="/" className="relative"><Logo size={36} /></Link>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-extrabold leading-tight tracking-tight text-ink">Interview scheduling, <span className="bg-gradient-to-r from-brand to-violet bg-clip-text text-transparent">without the chaos.</span></h2>
          <p className="mt-4 text-muted">Constraint-based scheduling, one-click self-booking and blinded evaluations — for coordinators, interviewers, candidates and hiring teams.</p>
          <ul className="mt-8 space-y-4 text-sm text-ink">
            {[[CalendarCheck2, 'Conflict-free schedules, verified independently'], [ShieldCheck, 'Role-based access and blinded evaluation'], [Sparkles, 'Minimal-disruption rescheduling when plans change']].map(([I, t]) => (
              <li key={t} className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-soft text-brand"><I size={18} /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted">© {new Date().getFullYear()} Recruitly</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md animate-fadeUp">
          <Link to="/" className="mb-8 inline-block lg:hidden"><Logo /></Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}