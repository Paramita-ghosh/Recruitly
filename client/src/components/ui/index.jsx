import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import { cn, label, STATUS_TONE } from '../../lib/utils';

export function Button({ variant = 'primary', size, loading, icon: Icon, children, className, ...rest }) {
  const v = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger' }[variant];
  return (
    <button className={cn(v, size === 'sm' && 'btn-sm', className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={15} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

const TONES = {
  blue: 'bg-brand/10 text-brand', green: 'bg-ok/10 text-ok', red: 'bg-bad/10 text-bad', amber: 'bg-amber/20 text-[#9A6B00] dark:text-amber',
  violet: 'bg-violet/10 text-violet', teal: 'bg-teal/10 text-teal', gray: 'bg-soft text-muted',
};
export function Badge({ tone = 'gray', children, className, dot }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status] || 'gray'} dot>{label(status)}</Badge>;

export function Card({ title, subtitle, action, children, className, pad = true }) {
  return (
    <section className={cn('card', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-ink">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {breadcrumb && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand">{breadcrumb}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label: l, error, hint, children, className }) {
  return (
    <div className={className}>
      {l && <label className="label">{l}</label>}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-bad" role="alert">{error}</p>}
    </div>
  );
}

export function Skeleton({ className }) { return <div className={cn('skeleton h-4 w-full', className)} />; }
export function SkeletonRows({ rows = 5 }) {
  return <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>;
}
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton className="mb-2 h-8 w-64" /><Skeleton className="mb-8 h-4 w-96" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl2" />)}</div>
      <Skeleton className="h-72 rounded-xl2" />
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-brand"><Icon size={26} /></div>
      <h4 className="text-base font-bold text-ink">{title}</h4>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" role="alert">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-bad/10 text-bad"><AlertTriangle size={26} /></div>
      <h4 className="text-base font-bold text-ink">Something went wrong</h4>
      <p className="mt-1 max-w-md text-sm text-muted">{message}</p>
      {onRetry && <Button variant="secondary" className="mt-4" onClick={() => onRetry()}>Try again</Button>}
    </div>
  );
}

/** Wraps a useAsync result: skeleton → error → empty → children(data). */
export function Async({ state, children, empty, skeleton = <PageSkeleton />, isEmpty }) {
  if (state.loading && !state.data) return skeleton;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (state.data == null) return null;
  if (empty && (isEmpty ? isEmpty(state.data) : Array.isArray(state.data) && state.data.length === 0)) return empty;
  return children(state.data);
}

export function Stat({ label: l, value, icon: Icon, tone = 'blue', hint, trend }) {
  const bg = { blue: 'bg-brand/10 text-brand', teal: 'bg-teal/10 text-teal', violet: 'bg-violet/10 text-violet', amber: 'bg-amber/20 text-[#9A6B00] dark:text-amber', red: 'bg-bad/10 text-bad', green: 'bg-ok/10 text-ok' }[tone];
  return (
    <div className="card flex items-start gap-4 p-5">
      {Icon && <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', bg)}><Icon size={22} /></div>}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{l}</p>
        <p className="mt-0.5 text-2xl font-extrabold tracking-tight text-ink">{value}</p>
        {(hint || trend) && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn('card flex max-h-[92vh] w-full animate-fadeUp flex-col rounded-b-none shadow-pop sm:rounded-b-xl2', w)}>
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-base font-bold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-soft hover:text-ink" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="scroll-thin overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="scroll-thin mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition', value === t.id ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.count != null && <span className="ml-1.5 rounded-full bg-soft px-1.5 py-0.5 text-[10px]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Table({ columns, rows, rowKey = 'id', onRow, empty, dense }) {
  if (!rows.length) return empty || null;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead><tr className="border-b border-line bg-soft/60">{columns.map((c) => <th key={c.key} className={cn('th', c.className)}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} onClick={onRow ? () => onRow(r) : undefined} className={cn('border-b border-line/70 last:border-0', onRow && 'cursor-pointer hover:bg-soft/50')}>
              {columns.map((c) => <td key={c.key} className={cn('td', dense && 'py-2', c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Avatar({ name, size = 36 }) {
  const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const hue = [...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
  const bg = ['bg-brand', 'bg-violet', 'bg-teal', 'bg-navy'][hue];
  return <span style={{ width: size, height: size }} className={cn('grid shrink-0 place-items-center rounded-full text-xs font-bold text-white', bg)}>{initials}</span>;
}

export function Progress({ value, tone = 'brand' }) {
  const c = { brand: 'bg-brand', ok: 'bg-ok', amber: 'bg-amber', bad: 'bg-bad' }[tone];
  return <div className="h-2 w-full overflow-hidden rounded-full bg-soft"><div className={cn('h-full rounded-full transition-all', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function Toggle({ checked, onChange, label: l }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 rounded-full transition', checked ? 'bg-brand' : 'bg-line')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {l}
    </label>
  );
}

export function Confirm({ open, title, text, confirmLabel = 'Confirm', danger, onConfirm, onClose, loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p className="text-sm text-muted">{text}</p>
    </Modal>
  );
}

export function Note({ tone = 'info', title, children }) {
  const t = { info: 'border-brand/30 bg-brand/5', warn: 'border-amber/50 bg-amber/10', error: 'border-bad/30 bg-bad/5', ok: 'border-ok/30 bg-ok/5' }[tone];
  return <div className={cn('rounded-xl border p-4 text-sm', t)}>{title && <p className="mb-1 font-bold text-ink">{title}</p>}<div className="text-muted">{children}</div></div>;
}
