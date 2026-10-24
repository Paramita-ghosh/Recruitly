import { useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { useTheme } from '../../context/ThemeContext';

const ROUND_COLORS = ['#3563E9', '#7C5CFC', '#0D9488', '#F4B942', '#D92D3A'];

/** FullCalendar wrapper. `sessions` use the API's interview shape; `onSelect(session)` fires on click. */
export default function ScheduleCalendar({ sessions, timezone = 'Asia/Kolkata', initialDate, onSelect, height = 680, dayStart = '07:00', dayEnd = '21:00', colorBy = 'round', showCandidate = true, view = 'timeGridWeek' }) {
  const { theme } = useTheme();
  const ref = useRef(null);
  const events = useMemo(() => sessions.filter((s) => s.status !== 'cancelled').map((s) => {
    const color = s.status === 'completed' ? '#667085' : s.resultStatus === 'failed' ? '#D92D3A' : ROUND_COLORS[((colorBy === 'mode' ? (s.mode === 'online' ? 1 : 0) : (s.roundPosition || 1) - 1)) % ROUND_COLORS.length];
    return {
      id: s.id, start: s.startsAt, end: s.endsAt, backgroundColor: color, borderColor: color,
      title: `${showCandidate ? s.candidateName : s.roundName}${s.interviewers?.length ? ` · ${s.interviewers.map((i) => i.name.split(' ')[0]).join('/')}` : ''}`,
      extendedProps: { s },
      textColor: color === '#F4B942' ? '#3d2c00' : '#fff',
    };
  }), [sessions, colorBy, showCandidate]);
  const start = initialDate || sessions.find((s) => s.status !== 'cancelled')?.startsAt;
  return (
    <FullCalendar
      key={theme + (start || '')}
      ref={ref}
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
      initialView={view}
      initialDate={start ? new Date(start) : undefined}
      timeZone={timezone}
      headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek' }}
      buttonText={{ today: 'Today', day: 'Day', week: 'Week', month: 'Month', list: 'List' }}
      height={height}
      slotMinTime={`${String(Math.max(0, Number(dayStart.slice(0, 2)) - 1)).padStart(2, '0')}:00:00`}
      slotMaxTime={`${String(Math.min(24, Number(dayEnd.slice(0, 2)) + 1)).padStart(2, '0')}:00:00`}
      slotDuration="00:30:00"
      allDaySlot={false}
      nowIndicator
      expandRows
      eventMaxStack={4}
      events={events}
      eventClick={(i) => onSelect?.(i.event.extendedProps.s)}
      eventContent={(arg) => (
        <div className="overflow-hidden px-1 text-[11px] leading-tight">
          <div className="truncate font-semibold">{arg.event.title}</div>
          {arg.view.type.startsWith('timeGrid') && <div className="truncate opacity-80">{arg.timeText}</div>}
        </div>
      )}
    />
  );
}
