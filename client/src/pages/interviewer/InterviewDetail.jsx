import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import EvaluationPanel from '../../components/shared/EvaluationPanel';
import { PageHeader } from '../../components/ui';

export default function InterviewDetail() {
  const { id } = useParams();
  return (
    <>
      <Link to="/interviewer/interviews" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"><ArrowLeft size={15} />Back to interviews</Link>
      <PageHeader title="Evaluate interview" subtitle="Score each criterion. Your scores stay private until every panelist has submitted." />
      <EvaluationPanel sessionId={id} role="interviewer" />
    </>
  );
}
