import Link from 'next/link';

export function HomeFooter({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  return (
    <footer className="home-footer">
      <div>
        <span className="footer-mark" aria-hidden="true" />
        <strong>Field Atlas</strong>
      </div>
      <p>For everywhere worth remembering.</p>
      <nav aria-label="Footer navigation">
        <Link href={isLoggedIn ? '/dashboard' : '/login'}>
          {isLoggedIn ? 'Your atlas' : 'Sign in'}
        </Link>
        <a href="#featured">Explore</a>
        <a href="#about">About</a>
      </nav>
    </footer>
  );
}
