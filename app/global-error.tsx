'use client';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; color: #10231d; background: #f5f2e9; font-family: Arial, sans-serif; }
          .global-error-page { display: grid; min-height: 100svh; place-items: center; padding: 1rem; }
          .global-error-page section { width: min(100%, 40rem); padding: clamp(1.5rem, 6vw, 4rem); border: 1px solid rgba(16,35,29,.14); border-radius: 2rem; background: #fbfaf5; box-shadow: 0 2rem 6rem rgba(16,35,29,.12); }
          .global-error-page section > p:first-child { color: #4c6a5b; font-size: .7rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
          .global-error-page h1 { max-width: 10ch; margin: 2rem 0 1rem; font-family: Georgia, serif; font-size: clamp(2.5rem, 8vw, 4.7rem); font-weight: 400; letter-spacing: -.055em; line-height: .98; }
          .global-error-page section > p:last-of-type { max-width: 32rem; color: #4c6a5b; line-height: 1.7; }
          .global-error-page button { min-height: 3rem; margin-top: 1.7rem; padding: .8rem 1.15rem; border: 0; border-radius: 999px; background: #10231d; color: #fbfaf5; font-weight: 800; cursor: pointer; }
        `}</style>
      </head>
      <body>
        <main className="global-error-page">
          <section>
            <p>Field Atlas</p>
            <h1>The atlas could not open.</h1>
            <p>
              Your memories are unchanged. Please try loading Field Atlas again.
            </p>
            <button type="button" onClick={reset}>
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
