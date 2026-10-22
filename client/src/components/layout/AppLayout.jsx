import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Menu, Moon, Search, Sun, X, CheckCheck } from 'lucide-react';
import { useAuth, HOME } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { get, patch, post } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useDebounced } from '../../lib/hooks';
import { cn, fmtAgo, label } from '../../lib/utils';
import { Avatar, Badge } from '../ui';
import { NAV } from './nav';
import Logo from './Logo';

function Sidebar({ role, onNavigate }) {
  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex h-16 shrink-0 items-center px-5"><Logo light /></div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {NAV[role].map((g) => (
          <div key={g.group}>
            <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[.12em] text-white/40">{g.group}</p>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate}
                className={({ isActive }) => cn('group mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition', isActive ? 'bg-white/12 text-white shadow-inner' : 'text-white/65 hover:bg-white/8 hover:text-white')}>
                {({ isActive }) => (<><it.icon size={17} className={isActive ? 'text-[#7FA2FF]' : 'text-white/50 group-hover:text-white/80'} />{it.label}</>)}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

function NotificationBell({ role }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, items: [] });
  const navigate = useNavigate();
  const ref = useRef(null);
  const toast = useToast();
  const { user } = useAuth();

  const load = () => get('/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const s = getSocket();
    s.connect();
    const onNote = (n) => { setData((d) => ({ unread: d.unread + 1, items: [{ id: n.id, category: n.category, title: n.title, body: n.body, link: n.link, read: false, createdAt: n.created_at || new Date().toISOString() }, ...d.items].slice(0, 30) })); toast.info(n.title); };
    s.on('notification', onNote);
    return () => { s.off('notification', onNote); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const readAll = async () => { await post('/notifications/read-all'); load(); };
  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) {
      setData((d) => ({ unread: Math.max(0, d.unread - 1), items: d.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }));
      patch(`/notifications/${n.id}/read`).catch(() => {});
    }
    if (n.link) navigate(n.link);
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen((o) => !o); if (!open) load(); }} className="relative rounded-lg p-2 text-muted transition hover:bg-soft hover:text-ink" aria-label={`Notifications, ${data.unread} unread`}>
        <Bell size={19} />
        {data.unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-[min(92vw,380px)] animate-fadeUp shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-bold">Notifications</p>
            {data.unread > 0 && <button onClick={readAll} className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline"><CheckCheck size={14} />Mark all read</button>}
          </div>
          <div className="scroll-thin max-h-[380px] overflow-y-auto">
            {data.items.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">You're all caught up.</p>}
            {data.items.slice(0, 8).map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={cn('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left last:border-0 hover:bg-soft/60', !n.read && 'bg-brand/5')}>
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{n.title}</span><span className="line-clamp-2 text-xs text-muted">{n.body}</span><span className="mt-1 block text-[11px] text-muted/80">{fmtAgo(n.createdAt)}</span></span>
              </button>
            ))}
          </div>
          <Link to={`/${role}/notifications`} onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-xs font-semibold text-brand hover:bg-soft/60">View all notifications</Link>
        </div>
      )}
    </div>
  );
}

function GlobalSearch({ role }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const dq = useDebounced(q, 250);
  const navigate = useNavigate();
  const ref = useRef(null);
  const pages = useMemo(() => NAV[role].flatMap((g) => g.items), [role]);
  const matches = q.trim() ? pages.filter((p) => p.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  useEffect(() => {
    if (role !== 'coordinator' || dq.trim().length < 2) { setPeople([]); return; }
    Promise.all([get('/candidates', { search: dq }), get('/interviewers', { search: dq })])
      .then(([c, i]) => setPeople([...c.slice(0, 4).map((x) => ({ ...x, kind: 'candidates' })), ...i.slice(0, 3).map((x) => ({ ...x, kind: 'interviewers' }))])).catch(() => setPeople([]));
  }, [dq, role]);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.querySelector('input')?.focus(); } };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  const go = (to) => { setOpen(false); setQ(''); navigate(to); };
  return (
    <div className="relative hidden w-full max-w-sm md:block" ref={ref}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input className="input pl-9 pr-14" placeholder="Search pages or people…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} aria-label="Search" />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line bg-soft px-1.5 py-0.5 text-[10px] font-semibold text-muted">Ctrl K</kbd>
      {open && q.trim() && (
        <div className="card absolute z-40 mt-2 w-full animate-fadeUp overflow-hidden shadow-pop">
          {matches.length === 0 && people.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No results for “{q}”</p>}
          {matches.map((m) => <button key={m.to} onClick={() => go(m.to)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-soft"><m.icon size={16} className="text-brand" />{m.label}</button>)}
          {people.map((p) => <button key={p.id} onClick={() => go(`/coordinator/${p.kind}?search=${encodeURIComponent(p.name)}`)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-soft"><Avatar name={p.name} size={24} /><span className="flex-1 truncate">{p.name}</span><Badge tone="gray">{p.role}</Badge></button>)}
        </div>
      )}
    </div>
  );
}

function DriveSwitcher() {
  const { drives, driveId, setDriveId } = useDrive();
  if (!drives.length) return null;
  return (
    <div className="relative hidden lg:block">
      <select className="input max-w-[260px] appearance-none truncate py-1.5 pl-3 pr-8 text-xs font-semibold" value={driveId} onChange={(e) => setDriveId(e.target.value)} aria-label="Current drive">
        {drives.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

function Breadcrumb({ role }) {
  const { pathname } = useLocation();
  const flat = NAV[role].flatMap((g) => g.items);
  const cur = flat.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  return <p className="hidden text-sm font-semibold text-muted sm:block"><span className="text-brand">{label(role)}</span><span className="mx-2 text-line">/</span><span className="text-ink">{cur?.label || 'Page'}</span></p>;
}

export default function AppLayout() {
  const { user, logout, config } = useAuth();
  const { theme, toggle } = useTheme();
  const [mobile, setMobile] = useState(false);
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  useEffect(() => setMobile(false), [pathname]);
  useEffect(() => {
    const h = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const role = user.role;
  const staff = role === 'coordinator' || role === 'company';
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-navy lg:block"><Sidebar role={role} /></aside>
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy/60" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-fadeUp bg-navy"><button className="absolute right-3 top-4 text-white/70" onClick={() => setMobile(false)} aria-label="Close menu"><X size={20} /></button><Sidebar role={role} onNavigate={() => setMobile(false)} /></aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-card/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-soft lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu"><Menu size={20} /></button>
          <Breadcrumb role={role} />
          <div className="mx-auto flex flex-1 justify-center md:px-6"><GlobalSearch role={role} /></div>
          {staff && <DriveSwitcher />}
          {config?.demoMode && <Badge tone="amber" className="hidden xl:inline-flex">Demo mode</Badge>}
          <button onClick={toggle} className="rounded-lg p-2 text-muted transition hover:bg-soft hover:text-ink" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
          <NotificationBell role={role} />
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-soft" aria-label="Account menu">
              <Avatar name={user.name} size={32} /><ChevronDown size={14} className="hidden text-muted sm:block" />
            </button>
            {menu && (
              <div className="card absolute right-0 z-40 mt-2 w-60 animate-fadeUp shadow-pop">
                <div className="border-b border-line px-4 py-3"><p className="truncate text-sm font-bold">{user.name}</p><p className="truncate text-xs text-muted">{user.email}</p><Badge tone="blue" className="mt-2">{label(role)}</Badge></div>
                <button onClick={async () => { await logout(); navigate('/login'); }} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-bad hover:bg-soft"><LogOut size={16} />Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] animate-fadeUp px-4 py-6 sm:px-6 lg:px-8"><Outlet /></main>
      </div>
    </div>
  );
}

export { HOME };
