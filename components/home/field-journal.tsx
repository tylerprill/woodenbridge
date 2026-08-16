import {
  BookmarkIcon,
  GlobeAmericasIcon,
  MapIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

const principles = [
  {
    icon: MapIcon,
    title: 'Drop a pin',
    copy: 'Mark any place you have visited or hope to remember someday.',
  },
  {
    icon: GlobeAmericasIcon,
    title: 'Tell the story',
    copy: 'Add a photo, a brief title, and the details that made it yours.',
  },
  {
    icon: BookmarkIcon,
    title: 'Keep your atlas',
    copy: 'Return to every journey through one thoughtful, personal map.',
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
            More than a pin on a map.
            <span>A memory with a place.</span>
          </h2>
          <p>
            Field Atlas gives every journey a home. Preserve the places,
            photographs, and small details you want to carry forward.
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
          Pin the places you have been, preserve what happened there, and keep
          the journeys still ahead within reach.
        </p>
        <Link href="/sign-up" className="callout-action">
          Create your atlas
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </>
  );
}
