import { PageHeader } from '../../components/ui';
import AvailabilityEditor from '../../components/shared/AvailabilityEditor';

export default function InterviewerAvailability() {
  return (
    <>
      <PageHeader title="Availability grid" subtitle="Paint the times you can interview. The scheduler never books you outside these blocks, and never over your daily capacity." />
      <AvailabilityEditor title="Weekly availability" />
    </>
  );
}
