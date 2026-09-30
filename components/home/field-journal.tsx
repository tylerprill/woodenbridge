import {
  BookOpenIcon,
  CheckCircleIcon,
  MapIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

const principles = [
  {
    icon: PhotoIcon,
    metric: 'One place',
    title: 'Place the moment.',
    copy: 'Start with the spot that matters and give the Memory a home on your atlas.',
  },
  {
    icon: MapIcon,
    metric: 'One complete Memory',
    title: 'Keep every detail together.',
    copy: 'Add multiple photos, the date, and the field notes you want to remember.',
  },
  {
    icon: BookOpenIcon,
    metric: 'One connected Journey',
    title: 'Build the story over time.',
    copy: 'Connect Memories into a Journey whenever they belong to something bigger.',
  },
];

export function FieldJournal({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  return (
    <>
      <section
        id="how-it-works"
        className="journal-section efficiency-section"
        aria-labelledby="journal-title"
      >
        <div className="journal-intro">
          <p className="section-kicker">Why it’s faster · 02</p>
          <h2 id="journal-title">
            Build one Memory.
            <span>Let the Journey follow.</span>
          </h2>
          <p>
            Field Atlas keeps place, photos, and details together from the
            start. Add what matters now and shape the larger story when you’re
            ready.
          </p>
        </div>

        <ol className="principle-list">
          {principles.map(({ icon: Icon, metric, title, copy }, index) => (
            <li className="principle-item" key={title}>
              <span className="principle-number" aria-hidden="true">
                0{index + 1}
              </span>
              <span className="principle-icon">
                <Icon aria-hidden="true" />
              </span>
              <div>
                <small>{metric}</small>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="privacy"
        className="collection-callout"
        aria-labelledby="collection-title"
      >
        <div className="callout-rings" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="section-kicker">Private by default · 03</p>
        <h2 id="collection-title">Your next Memory starts with a place.</h2>
        <p>
          Place it on your atlas, add up to six photos and the details the
          moment needs, and connect it to a Journey whenever you choose. Every
          Memory begins private and remains editable.
        </p>
        <ul className="callout-trust" aria-label="Privacy promises">
          <li>
            <CheckCircleIcon aria-hidden="true" /> Private on arrival
          </li>
          <li>
            <CheckCircleIcon aria-hidden="true" /> Places stay editable
          </li>
          <li>
            <CheckCircleIcon aria-hidden="true" /> Share only when ready
          </li>
        </ul>
        <Link
          href={
            isLoggedIn ? '/dashboard?new=memory' : '/sign-up?intent=new-memory'
          }
          className="callout-action"
        >
          {isLoggedIn ? 'Place another Memory' : 'Place your first Memory'}
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </>
  );
}
