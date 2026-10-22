import { Link } from 'react-router-dom';
import Logo from '../../components/layout/Logo';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <Logo className="mb-8" />
        <p className="text-7xl font-extrabold tracking-tight text-brand">404</p>
        <h1 className="mt-3 text-2xl font-bold">This page took a day off</h1>
        <p className="mt-2 text-sm text-muted">The page you're looking for doesn't exist or has moved.</p>
        <Link to="/" className="btn-primary mt-6">Back to Recruitly</Link>
      </div>
    </div>
  );
}
