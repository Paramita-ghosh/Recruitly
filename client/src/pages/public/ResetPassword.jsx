import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { post, errMsg } from '../../lib/api';
import { Button, Field } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import AuthShell from './AuthShell';

/** Used for both "forgot password" links and first-time invitation links (?invite=1). */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const invite = params.get('invite') === '1';
  const navigate = useNavigate();
  const toast = useToast();
  const [error, setError] = useState('');
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm();
  const submit = async (v) => {
    setError('');
    try { await post('/auth/reset-password', { token, password: v.password }); toast.success(invite ? 'Account activated. Please sign in.' : 'Password updated. Please sign in.'); navigate('/login', { replace: true }); } catch (e) { setError(errMsg(e)); }
  };
  if (!token) return <AuthShell title="Invalid link" subtitle="This link is missing its token. Request a new one."><Link to="/forgot-password" className="btn-primary w-full">Request a new link</Link></AuthShell>;
  return (
    <AuthShell title={invite ? 'Activate your account' : 'Choose a new password'} subtitle={invite ? 'Set a password to finish setting up your Recruitly account.' : 'Pick a strong password you have not used elsewhere.'} footer={<Link to="/login" className="font-semibold text-brand hover:underline">Back to sign in</Link>}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {error && <div className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2.5 text-sm text-bad" role="alert">{error}</div>}
        <Field label="New password" error={errors.password?.message} hint="At least 8 characters with a letter and a number.">
          <input className="input" type="password" autoComplete="new-password" {...register('password', { required: 'Choose a password', minLength: { value: 8, message: 'Use at least 8 characters' }, validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Include a letter and a number' })} />
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message}><input className="input" type="password" autoComplete="new-password" {...register('confirm', { validate: (v) => v === watch('password') || 'Passwords do not match' })} /></Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>{invite ? 'Activate account' : 'Update password'}</Button>
      </form>
    </AuthShell>
  );
}
