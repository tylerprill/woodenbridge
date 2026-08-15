import Link from 'next/link';

export function HomeFooter() {
  return (
    <footer className="home-footer">
      <div>
        <span className="footer-mark" aria-hidden="true" />
        <strong>Wooden Bridge</strong>
      </div>
      <p>Go slowly. Cross thoughtfully.</p>
      <nav aria-label="Footer navigation">
        <Link href="/login">Sign in</Link>
        <a href="#featured">Explore</a>
        <a href="#about">About</a>
      </nav>
    </footer>
  );
}
