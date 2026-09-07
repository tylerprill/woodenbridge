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
    metric: 'One batch',
    title: 'Select the trip once.',
    copy: 'Photos keep their captured order while the whole journey moves forward together.',
  },
  {
    icon: MapIcon,
    metric: 'Exceptions only',
    title: 'Skip the obvious checks.',
    copy: 'Clear place and date matches move on. Only uncertain photos ask for your attention.',
  },
  {
    icon: BookOpenIcon,
    metric: 'One final choice',
    title: 'Finish in the right shape.',
    copy: 'Keep individual memories or gather the trip into a chapter—without rebuilding either.',
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
            Your attention goes
            <span>only where it matters.</span>
          </h2>
          <p>
            Field Atlas handles the repeatable first pass, then gets out of your
            way. You stay responsible for the moments that need judgment.
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
        <h2 id="collection-title">
          Your next chapter is already in your camera roll.
        </h2>
        <p>
          Start with the photos you already have. Every imported memory begins
          private, every place remains editable, and nothing is shared until you
          choose.
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
            isLoggedIn ? '/dashboard/import' : '/sign-up?intent=photo-import'
          }
          className="callout-action"
        >
          {isLoggedIn ? 'Upload another journey' : 'Upload your first journey'}
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </>
  );
}
