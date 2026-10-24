import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import ProtectedRoute, { RedirectHome, Splash } from './components/layout/ProtectedRoute';
import NotificationsPage from './components/shared/NotificationsPage';

import Landing from './pages/public/Landing';
import Login from './pages/public/Login';
import Register from './pages/public/Register';
import ForgotPassword from './pages/public/ForgotPassword';
import ResetPassword from './pages/public/ResetPassword';
import DemoMeeting from './pages/public/DemoMeeting';
import AuthCallback from './pages/public/AuthCallback';
import NotFound from './pages/public/NotFound';

import CoordinatorDashboard from './pages/coordinator/Dashboard';
import Drives from './pages/coordinator/Drives';
import Rounds from './pages/coordinator/Rounds';
import Rubrics from './pages/coordinator/Rubrics';
import Rooms from './pages/coordinator/Rooms';
import Companies from './pages/coordinator/Companies';

import InterviewerDashboard from './pages/interviewer/Dashboard';

import CandidateDashboard from './pages/candidate/Dashboard';

import { CompanyDashboard, CompanyDrives, CompanyCandidates, CompanySchedule, CompanyEvaluations, CompanyReports, CompanyProfile } from './pages/company/Pages';
import { useDrive } from './context/DriveContext';

/* Pages not pasted yet render a placeholder, so every route and sidebar link still opens. Delete a line below once you paste the real page and import it above. */
import { PageHeader, Card, EmptyState } from './components/ui';
import { Hammer } from 'lucide-react';
const Placeholder = ({ name }) => (
  <div><PageHeader title={name} subtitle="This page is not added to the project yet." /><Card><EmptyState icon={Hammer} title={`${name} - coming soon`} text="Paste this feature's files to enable it." /></Card></div>
);
const Booking = () => <Placeholder name="Booking" />;
const Calendar = () => <Placeholder name="Calendar" />;
const Generator = () => <Placeholder name="Generator" />;
const Quality = () => <Placeholder name="Quality" />;
const Unscheduled = () => <Placeholder name="Unscheduled" />;
const Reschedule = () => <Placeholder name="Reschedule" />;
const AvailabilityOverview = () => <Placeholder name="AvailabilityOverview" />;
const PipelinePage = () => <Placeholder name="PipelinePage" />;
const Evaluations = () => <Placeholder name="Evaluations" />;
const People = () => <Placeholder name="People" />;
const Import = () => <Placeholder name="Import" />;
const Audit = () => <Placeholder name="Audit" />;
const Settings = () => <Placeholder name="Settings" />;
const InterviewerInterviews = () => <Placeholder name="InterviewerInterviews" />;
const InterviewsPage = () => <Placeholder name="Interviews" />;
const InterviewDetail = () => <Placeholder name="InterviewDetail" />;
const InterviewerAvailability = () => <Placeholder name="InterviewerAvailability" />;
const InterviewerProfile = () => <Placeholder name="InterviewerProfile" />;
const InterviewerModes = () => <Placeholder name="InterviewerModes" />;
const CandidateDrives = () => <Placeholder name="CandidateDrives" />;
const CandidateProgress = () => <Placeholder name="CandidateProgress" />;
const CandidateAvailability = () => <Placeholder name="CandidateAvailability" />;
const CandidateProfile = () => <Placeholder name="CandidateProfile" />;

/** Notification links such as /coordinator/drives/<id>/reschedule?run=… select that drive, then open the page. */
function DriveRedirect({ to }) {
  const { id } = useParams();
  const { setDriveId } = useDrive();
  const [sp] = useSearchParams();
  setTimeout(() => setDriveId(id), 0);
  return <Navigate to={`${to}${sp.toString() ? `?${sp}` : ''}`} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/book/:token" element={<Booking />} />
        <Route path="/demo-meeting/:id" element={<DemoMeeting />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/app" element={<RedirectHome />} />

        <Route path="/coordinator" element={<ProtectedRoute roles={['coordinator']} />}>
          <Route index element={<CoordinatorDashboard />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="generator" element={<Generator />} />
          <Route path="quality" element={<Quality />} />
          <Route path="unscheduled" element={<Unscheduled />} />
          <Route path="reschedule" element={<Reschedule />} />
          <Route path="availability" element={<AvailabilityOverview />} />
          <Route path="drives" element={<Drives />} />
          <Route path="drives/:id" element={<DriveRedirect to="/coordinator/calendar" />} />
          <Route path="drives/:id/reschedule" element={<DriveRedirect to="/coordinator/reschedule" />} />
          <Route path="rounds" element={<Rounds />} />
          <Route path="rubrics" element={<Rubrics />} />
          <Route path="evaluations" element={<Evaluations />} />
          <Route path="rooms" element={<Rooms />} />
          <Route path="companies" element={<Companies />} />
          <Route path="candidates" element={<People kind="candidates" />} />
          <Route path="interviewers" element={<People kind="interviewers" />} />
          <Route path="import" element={<Import />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="/interviewer" element={<ProtectedRoute roles={['interviewer']} />}>
          <Route index element={<InterviewerDashboard />} />
          <Route path="interviews" element={<InterviewerInterviews />} />
          <Route path="interviews/:id" element={<InterviewDetail />} />
          <Route path="evaluations" element={<InterviewsPage role="interviewer" pendingOnly />} />
          <Route path="availability" element={<InterviewerAvailability />} />
          <Route path="modes" element={<InterviewerModes />} />
          <Route path="profile" element={<InterviewerProfile />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        <Route path="/candidate" element={<ProtectedRoute roles={['candidate']} />}>
          <Route index element={<CandidateDashboard />} />
          <Route path="drives" element={<CandidateDrives />} />
          <Route path="interviews" element={<InterviewsPage role="candidate" />} />
          <Route path="progress" element={<CandidateProgress />} />
          <Route path="availability" element={<CandidateAvailability />} />
          <Route path="profile" element={<CandidateProfile />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        <Route path="/company" element={<ProtectedRoute roles={['company']} />}>
          <Route index element={<CompanyDashboard />} />
          <Route path="drives" element={<CompanyDrives />} />
          <Route path="candidates" element={<CompanyCandidates />} />
          <Route path="schedule" element={<CompanySchedule />} />
          <Route path="pipeline" element={<PipelinePage readOnly />} />
          <Route path="evaluations" element={<CompanyEvaluations />} />
          <Route path="reports" element={<CompanyReports />} />
          <Route path="profile" element={<CompanyProfile />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
void lazy;