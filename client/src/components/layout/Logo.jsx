import { cn } from '../../lib/utils';

export default function Logo({ light, size = 32, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4F7CFF" /><stop offset="1" stopColor="#7C5CFC" /></linearGradient></defs>
        <rect width="64" height="64" rx="16" fill="url(#rg)" />
        <path d="M20 46V18h14a10 10 0 0 1 3 19.6L45 46h-8l-6.6-7.4H27V46z M27 32h7a4 4 0 0 0 0-8h-7z" fill="#fff" fillRule="evenodd" />
      </svg>
      <span className="text-xl font-extrabold tracking-tight text-ink">Recruit<span className="text-brand">ly</span></span>
    </span>
  );
}
