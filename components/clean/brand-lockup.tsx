import Link from 'next/link';

type BrandLockupProps = {
  className?: string;
  label?: string;
};

export function BrandLockup({
  className = '',
  label = 'Field atlas',
}: BrandLockupProps) {
  return (
    <Link
      className={`brand-lockup ${className}`.trim()}
      href="/"
      aria-label="Wooden Bridge home"
    >
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span className="brand-name">
        Wooden Bridge
        <small>{label}</small>
      </span>
    </Link>
  );
}
