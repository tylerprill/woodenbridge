import Link from 'next/link';

type BrandLockupProps = {
  className?: string;
  label?: string;
  prefetch?: boolean;
};

export function BrandLockup({
  className = '',
  label = 'Travel journal',
  prefetch,
}: BrandLockupProps) {
  return (
    <Link
      className={`brand-lockup ${className}`.trim()}
      href="/"
      prefetch={prefetch}
      aria-label="Field Atlas home"
    >
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span className="brand-name">
        Field Atlas
        <small>{label}</small>
      </span>
    </Link>
  );
}
