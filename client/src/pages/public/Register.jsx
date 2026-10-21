import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth, HOME } from '../../context/AuthContext';
import { errMsg } from '../../lib/api';
import { Button, Field } from '../../components/ui';
import AuthShell from './AuthShell';

export default function Register() {
  const { register: signup } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm();
  const submit = async (v) => {
    setError('');
    try {
      const u = await signup({ name: v.name.trim(), email: v.email.trim(), password: v.password, regNo: v.regNo || undefined, department: v.department || undefined, branch: v.branch || undefined, gradYear: v.gradYear ? Number(v.gradYear) : undefined });
      navigate(HOME[u.role], { replace: true });
    } catch (e) { setError(errMsg(e)); }
  };
  return (
    <AuthShell title="Create your candidate account" subtitle="Interviewers, recruiters and coordinators are invited by email — this form is for candidates." footer={<>Already have an account? <Link to="/login" className="font-semibold text-brand hover:underline">Sign in</Link></>}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {error && <div className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2.5 text-sm text-bad" role="alert">{error}</div>}
        <Field label="Full name" error={errors.name?.message}><input className="input" autoComplete="name" {...register('name', { required: 'Enter your name', minLength: { value: 2, message: 'Name is too short' } })} /></Field>
        <Field label="Email" error={errors.email?.message}><input className="input" type="email" autoComplete="email" {...register('email', { required: 'Enter your email', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' } })} /></Field>
        <Field label="Password" error={errors.password?.message} hint="At least 8 characters with a letter and a number.">
          <input className="input" type="password" autoComplete="new-password" {...register('password', { required: 'Choose a password', minLength: { value: 8, message: 'Use at least 8 characters' }, validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Include a letter and a number' })} />
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message}><input className="input" type="password" autoComplete="new-password" {...register('confirm', { validate: (v) => v === watch('password') || 'Passwords do not match' })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Registration no."><input className="input" {...register('regNo')} /></Field>
          <Field label="Graduation year"><input className="input" type="number" min="2000" max="2100" {...register('gradYear')} /></Field>
          <Field label="Department"><input className="input" {...register('department')} /></Field>
          <Field label="Branch"><input className="input" {...register('branch')} /></Field>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
    </AuthShell>
  );
}
