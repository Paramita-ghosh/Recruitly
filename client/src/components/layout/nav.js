import {
  LayoutDashboard, CalendarDays, Users, UserCog, Building2, FolderKanban, FileUp, Clock3, DoorOpen, Layers, ListChecks, Wand2, Gauge,
  AlertTriangle, RefreshCcw, Kanban, Trophy, Bell, ScrollText, Settings, UserCircle, Video, Briefcase, ClipboardCheck, BarChart3, ClipboardList, Cpu,
} from 'lucide-react';

export const NAV = {
  coordinator: [
    { group: 'Overview', items: [
      { to: '/coordinator', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/coordinator/calendar', label: 'Schedule calendar', icon: CalendarDays },
      { to: '/coordinator/pipeline', label: 'Pipeline', icon: Kanban },
    ] },
    { group: 'Scheduling', items: [
      { to: '/coordinator/generator', label: 'Schedule generator', icon: Wand2 },
      { to: '/coordinator/quality', label: 'Quality report', icon: Gauge },
      { to: '/coordinator/unscheduled', label: 'Unscheduled & conflicts', icon: AlertTriangle },
      { to: '/coordinator/reschedule', label: 'Reschedule', icon: RefreshCcw },
      { to: '/coordinator/availability', label: 'Availability overview', icon: Clock3 },
    ] },
    { group: 'Recruitment', items: [
      { to: '/coordinator/drives', label: 'Drives', icon: FolderKanban },
      { to: '/coordinator/rounds', label: 'Rounds', icon: Layers },
      { to: '/coordinator/rubrics', label: 'Rubrics', icon: ListChecks },
      { to: '/coordinator/evaluations', label: 'Evaluation matrix', icon: Trophy },
      { to: '/coordinator/rooms', label: 'Rooms', icon: DoorOpen },
    ] },
    { group: 'People', items: [
      { to: '/coordinator/companies', label: 'Companies', icon: Building2 },
      { to: '/coordinator/candidates', label: 'Candidates', icon: Users },
      { to: '/coordinator/interviewers', label: 'Interviewers', icon: UserCog },
      { to: '/coordinator/import', label: 'CSV import', icon: FileUp },
    ] },
    { group: 'System', items: [
      { to: '/coordinator/notifications', label: 'Notifications', icon: Bell },
      { to: '/coordinator/audit', label: 'Audit logs', icon: ScrollText },
      { to: '/coordinator/settings', label: 'Settings', icon: Settings },
    ] },
  ],
  interviewer: [
    { group: 'Interviewing', items: [
      { to: '/interviewer', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/interviewer/interviews', label: 'My interviews', icon: Video },
      { to: '/interviewer/evaluations', label: 'Evaluations', icon: ClipboardCheck },
    ] },
    { group: 'Availability', items: [
      { to: '/interviewer/availability', label: 'Availability grid', icon: Clock3 },
      { to: '/interviewer/modes', label: 'Mode preferences', icon: Cpu },
      { to: '/interviewer/profile', label: 'Skills & profile', icon: UserCircle },
    ] },
    { group: 'System', items: [{ to: '/interviewer/notifications', label: 'Notifications', icon: Bell }] },
  ],
  candidate: [
    { group: 'My journey', items: [
      { to: '/candidate', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/candidate/drives', label: 'Drives', icon: Briefcase },
      { to: '/candidate/interviews', label: 'Interviews', icon: Video },
      { to: '/candidate/progress', label: 'Pipeline progress', icon: Kanban },
    ] },
    { group: 'Preparation', items: [
      { to: '/candidate/availability', label: 'My availability', icon: Clock3 },
      { to: '/candidate/profile', label: 'Profile', icon: UserCircle },
    ] },
    { group: 'System', items: [{ to: '/candidate/notifications', label: 'Notifications', icon: Bell }] },
  ],
  company: [
    { group: 'Hiring', items: [
      { to: '/company', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/company/drives', label: 'Drives', icon: FolderKanban },
      { to: '/company/candidates', label: 'Candidate pool', icon: Users },
      { to: '/company/schedule', label: 'Schedules', icon: CalendarDays },
      { to: '/company/pipeline', label: 'Pipeline', icon: Kanban },
    ] },
    { group: 'Insights', items: [
      { to: '/company/evaluations', label: 'Evaluation summaries', icon: ClipboardList },
      { to: '/company/reports', label: 'Reports', icon: BarChart3 },
    ] },
    { group: 'Account', items: [
      { to: '/company/profile', label: 'Company profile', icon: Building2 },
      { to: '/company/notifications', label: 'Notifications', icon: Bell },
    ] },
  ],
};
