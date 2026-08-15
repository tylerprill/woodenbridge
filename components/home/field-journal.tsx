import {
  BookmarkIcon,
  GlobeAmericasIcon,
  MapIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

const principles = [
  {
    icon: MapIcon,
    title: 'Find the crossing',
    copy: 'Explore by landscape, bridge form, or the journey you want to take.',
  },
  {
    icon: GlobeAmericasIcon,
    title: 'Read the place',
    copy: 'Carry the history, construction notes, and local context with you.',
  },
  {
    icon: BookmarkIcon,
    title: 'Keep what moves you',
    copy: 'Save favorites and shape a personal atlas for the road ahead.',
  },
];

export function FieldJournal() {
  return (
    <>
      <section
        id="journal"
        className="journal-section"
        aria-labelledby="journal-title"
      >
        <div className="journal-intro">
          <p className="section-kicker">The field journal · 02</p>
          <h2 id="journal-title">
            More than a route across.
            <span>A reason to stop.</span>
          </h2>
          <p>
            Wooden bridges are pieces of living infrastructure. We document the
            craft, landscape, and human stories that make each one worth
            finding.
          </p>
        </div>

        <div className="principle-list">
          {principles.map(({ icon: Icon, title, copy }, index) => (
            <article className="principle-item" key={title}>
              <span className="principle-number">0{index + 1}</span>
              <span className="principle-icon">
                <Icon aria-hidden="true" />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        id="about"
        className="collection-callout"
        aria-labelledby="collection-title"
      >
        <div className="callout-rings" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="section-kicker">Your own field atlas</p>
        <h2 id="collection-title">
          Keep a record of everywhere wonder takes you.
        </h2>
        <p>
          Collect bridges you love, remember those you have crossed, and plan
          the ones still ahead.
        </p>
        <Link href="/sign-up" className="callout-action">
          Create your collection
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </>
  );
}
