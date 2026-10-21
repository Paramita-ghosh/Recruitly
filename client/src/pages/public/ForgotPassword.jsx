import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { MailCheck } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { Button, Field, Note } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import AuthShell from './AuthShell';

export default function ForgotPassword() {
  const { config } = useAuth();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();
  const submit = async (v) => {
    setError('');
    try { await post('/auth/forgot-password', { email: v.email.trim() }); setSent(true); } catch (e) { setError(errMsg(e)); }
  };
  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we'll send you a reset link." footer={<Link to="/login" className="font-semibold text-brand hover:underline">Back to sign in</Link>}>
      {sent ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ok/10 text-ok"><MailCheck size={26} /></div>
          <p className="text-sm text-muted">If an account exists for that email, a reset link has been prepared. The link expires in one hour.</p>
          {config?.emailMode !== 'smtp' && <Note tone="warn" title="Email is not configured on this server">No email was actually delivered. In development the message is written to the server log (look for the reset link in the backend terminal). See the README to configure SMTP.</Note>}
        </div>
      ) : (
        <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
          {error && <div className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2.5 text-sm text-bad" role="alert">{error}</div>}
          <Field label="Email" error={errors.email?.message}><input className="input" type="email" {...register('email', { required: 'Enter your email', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' } })} /></Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
