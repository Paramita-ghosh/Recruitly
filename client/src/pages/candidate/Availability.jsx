import { PageHeader } from '../../components/ui';
import AvailabilityEditor from '../../components/shared/AvailabilityEditor';

export default function CandidateAvailability() {
  return (
    <>
      <PageHeader title="My availability" subtitle="Paint every time you could attend an interview. Mark your favourites as Preferred – the scheduler tries those first." />
      <AvailabilityEditor allowPreferred title="When can you interview?" />
    </>
  );
}
