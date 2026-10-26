import { PageHeader } from '../../components/ui';
import ProfileEditor from '../../components/shared/ProfileEditor';

export default function CandidateProfile() {
  return (<><PageHeader title="Profile" subtitle="Keep your details up to date – they're used for eligibility and shown to your coordinator." /><ProfileEditor /></>);
}
