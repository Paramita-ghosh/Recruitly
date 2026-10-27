import { PageHeader } from '../../components/ui';
import ProfileEditor from '../../components/shared/ProfileEditor';

export function InterviewerProfile() {
  return (<><PageHeader title="Skills & profile" subtitle="Your skills decide which rounds you can be assigned to." /><ProfileEditor /></>);
}
export function InterviewerModes() {
  return (<><PageHeader title="Mode preferences" subtitle="Tell us whether you interview in person, online, or both – and how much you can take on per day." /><ProfileEditor section="modes" /></>);
}
