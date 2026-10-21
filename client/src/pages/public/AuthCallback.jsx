import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, HOME } from '../../context/AuthContext';
import { Splash } from '../../components/layout/ProtectedRoute';

/** Landing page after Google sign-in: the server already set the cookie; load the user and go home. */
export default function AuthCallback() {
  const { refresh, user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!loading && user) navigate(HOME[user.role], { replace: true }); }, [user, loading, navigate]);
  useEffect(() => { const t = setTimeout(() => { if (!user) navigate('/login?error=' + encodeURIComponent('Sign-in could not be completed.'), { replace: true }); }, 4000); return () => clearTimeout(t); }, [user, navigate]);
  return <Splash />;
}
