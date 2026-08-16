import Link from 'next/link';

type BrandLockupProps = {
  className?: string;
  label?: string;
};

export function BrandLockup({
  className = '',
  label = 'Travel journal',
}: BrandLockupProps) {
  return (
    <Link
      className={`brand-lockup ${className}`.trim()}
      href="/"
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
