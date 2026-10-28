import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, Info } from 'lucide-react';
import { useAuth, HOME } from '../../context/AuthContext';
import { apiUrl, errMsg } from '../../lib/api';
import { Button, Field, Note } from '../../components/ui';
import AuthShell from './AuthShell';
import { label } from '../../lib/utils';

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.7l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
);

export default function Login() {
  const { login, config } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const [show, setShow] = useState(false);
  const [error, setError] = useState(params.get('error') || '');
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm({ defaultValues: { email: '', password: '' } });

  const submit = async (v) => {
    setError('');
    try {
      const u = await login(v.email.trim(), v.password);
      const from = loc.state?.from;
      navigate(from && from.startsWith(`/${u.role}`) ? from : HOME[u.role], { replace: true });
    } catch (e) { setError(errMsg(e)); }
  };
  const fill = (email) => { setValue('email', email); setValue('password', config.demoPassword); };
  const demos = config?.demoAccounts || [];
  const groups = ['coordinator', 'company', 'interviewer', 'candidate'].map((r) => [r, demos.filter((d) => d.role === r)]).filter(([, l]) => l.length);

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your Recruitly workspace." footer={<>New candidate? <Link to="/register" className="font-semibold text-brand hover:underline">Create an account</Link></>}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {error && <div className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2.5 text-sm text-bad" role="alert">{error}</div>}
        <Field label="Email" error={errors.email?.message}>
          <input className="input" type="email" autoComplete="username" placeholder="you@example.com" {...register('email', { required: 'Enter your email', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' } })} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <div className="relative">
            <input className="input pr-10" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password" {...register('password', { required: 'Enter your password' })} />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
        </Field>
        <div className="flex justify-end"><Link to="/forgot-password" className="text-xs font-semibold text-brand hover:underline">Forgot password?</Link></div>
        <Button type="submit" className="w-full" loading={isSubmitting}>Sign in</Button>
      </form>

      {config?.googleSignIn ? (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          <a href={apiUrl('/auth/google')} className="btn-secondary w-full"><GoogleG />Continue with Google</a>
          <p className="mt-2 text-center text-xs text-muted">New Google accounts are created as candidates. Staff roles are assigned by a coordinator.</p>
        </>
      ) : (
        <p className="mt-4 flex items-start gap-2 text-xs text-muted"><Info size={14} className="mt-0.5 shrink-0" />Google sign-in is not configured on this server. See the README to enable it.</p>
      )}
    </AuthShell>
  );
}
