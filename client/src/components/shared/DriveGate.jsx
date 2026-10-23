import { FolderKanban } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDrive } from '../../context/DriveContext';
import { useAuth } from '../../context/AuthContext';
import { EmptyState, PageSkeleton } from '../ui';

export default function DriveGate({ children }) {
  const { driveId, loading, drive } = useDrive();
  const { user } = useAuth();
  if (loading) return <PageSkeleton />;
  if (!driveId) {
    return <div className="card"><EmptyState icon={FolderKanban} title="No recruitment drive yet" text="Create a drive first – everything else (rounds, candidates, scheduling) lives inside a drive."
      action={user.role === 'coordinator' ? <Link to="/coordinator/drives" className="btn-primary">Create a drive</Link> : null} /></div>;
  }
  if (!drive) return <PageSkeleton />;
  return children(drive);
}
