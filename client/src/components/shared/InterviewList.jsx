import { Link } from 'react-router-dom';
import { CalendarPlus, MapPin, Video, Users2, ExternalLink } from 'lucide-react';
import { Badge, Button, StatusBadge } from '../ui';
import { fmtDate, fmtRange, label } from '../../lib/utils';
import { apiUrl } from '../../lib/api';

export function ModeBadge({ mode }) {
  return mode === 'online' ? <Badge tone="violet"><Video size={12} />Online</Badge> : <Badge tone="teal"><MapPin size={12} />Offline</Badge>;
}

export function IcsLink({ id, size = 'sm', children = 'Add to calendar' }) {
  return (
    <a href={apiUrl(`/interviews/${id}/ics`)} className={`btn-secondary ${size === 'sm' ? 'btn-sm' : ''}`} download>
      <CalendarPlus size={14} />{children}
    </a>
  );
}

export function Where({ s }) {
  if (s.mode === 'offline') return <span className="break-words text-sm text-muted">{s.roomName ? `${s.roomName}${s.roomLocation ? ` · ${s.roomLocation}` : ''}` : 'Room to be confirmed'}</span>;
  if (!s.meetingUrl) return <span className="text-sm text-muted">Meeting link pending</span>;
  return (
    <a href={s.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
      {s.meetingIsDemo ? 'Demo meeting room' : 'Join meeting'}<ExternalLink size={12} />
    </a>
  );
}

/**
 * Stacked layout so it works in narrow columns (two-column dashboards):
 *   [date tile] [time, date, name, badges, where]
 *   ─────────────────────────────────────────────
 *   [actions]
 */
export function InterviewCard({ s, viewer, actions }) {
  const dateText = fmtDate(s.startsAt, s.timezone);
  const showActions = Boolean(actions) || ['scheduled', 'in_progress'].includes(s.status);
  return (
    <div className="card p-4">
      <div className="flex items-start gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand/10 text-center text-brand">
          <div>
            <p className="text-[10px] font-bold uppercase leading-none">{dateText.split(',')[0]}</p>
            <p className="text-lg font-extrabold leading-tight">{dateText.split(' ')[1] || ''}</p>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{fmtRange(s.startsAt, s.endsAt, s.timezone)}</p>
          <p className="text-xs text-muted">{dateText}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="min-w-0 break-words text-sm font-bold text-ink">{viewer === 'candidate' ? s.roundName : s.candidateName}</p>
            <StatusBadge status={s.status} />
            <ModeBadge mode={s.mode} />
            {s.resultStatus && s.resultStatus !== 'pending' && s.resultPublished !== false && <Badge tone={s.resultStatus === 'passed' ? 'green' : 'red'}>{label(s.resultStatus)}</Badge>}
          </div>

          <p className="mt-1 break-words text-xs text-muted">{viewer === 'candidate' ? `${s.companyName} · ${s.driveName}` : `${s.roundName} · ${s.driveName}`}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Where s={s} />
            {s.interviewers?.length > 0 && viewer !== 'interviewer' && <span className="inline-flex items-center gap-1 text-xs text-muted"><Users2 size={13} />{s.interviewers.map((i) => i.name).join(', ')}</span>}
          </div>

          {s.mode === 'online' && s.meetingIsDemo && <p className="mt-1 text-[11px] text-[#9A6B00] dark:text-amber">Demo link – Google Meet is not connected, so this is a placeholder room.</p>}
        </div>
      </div>

      {showActions && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {actions}
          {['scheduled', 'in_progress'].includes(s.status) && <IcsLink id={s.id} />}
        </div>
      )}
    </div>
  );
}

export { Link, Button };