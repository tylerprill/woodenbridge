import {
  BookOpenIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  MapPinIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';

type PreviewKind = 'select' | 'recognize' | 'finish';

const features = [
  {
    index: '01',
    name: 'Place a Memory.',
    label: 'Choose its place',
    description:
      'Drop a pin where the moment happened so every photo and detail begins with the right place.',
    detail: 'Anywhere on your atlas',
    kind: 'select' as const,
  },
  {
    index: '02',
    name: 'Add the whole moment.',
    label: 'Photos and details',
    description:
      'Keep multiple photos together, then add the date, title, and field notes that make the Memory yours.',
    detail: 'Photos, date, and notes in one place',
    kind: 'recognize' as const,
  },
  {
    index: '03',
    name: 'Connect Memories into a Journey.',
    label: 'Build the story',
    description:
      'Bring related Memories together in order, then keep growing and refining the Journey over time.',
    detail: 'Reorder and edit anytime',
    kind: 'finish' as const,
  },
];

function FeaturePreview({ kind, index }: { kind: PreviewKind; index: string }) {
  return (
    <div
      className={`feature-product-preview feature-product-preview-${kind}`}
      aria-hidden="true"
    >
      <div className="feature-preview-bar">
        <span>Example Memory</span>
        <strong>{index} / 03</strong>
      </div>

      {kind === 'select' ? (
        <>
          <div className="photo-picker-preview">
            {['river', 'lantern', 'trail', 'coast', 'forest', 'city'].map(
              (tone) => (
                <span key={tone} data-tone={tone}>
                  <CheckCircleIcon />
                </span>
              ),
            )}
          </div>
          <div className="feature-preview-summary">
            <PhotoIcon />
            <span>
              <small>Added to this Memory</small>
              <strong>6 photos together</strong>
            </span>
          </div>
        </>
      ) : null}

      {kind === 'recognize' ? (
        <>
          <div className="recognition-map-preview">
            <span className="recognition-route" />
            <MapPinIcon className="recognition-pin recognition-pin-one" />
            <MapPinIcon className="recognition-pin recognition-pin-two" />
            <MapPinIcon className="recognition-pin recognition-pin-three" />
          </div>
          <div className="recognition-review-preview">
            <span>
              <CheckCircleIcon />
              <span>
                <small>Place and date</small>
                <strong>Saved to your atlas</strong>
              </span>
            </span>
            <span data-review="true">
              <ExclamationTriangleIcon />
              <span>
                <small>Add when ready</small>
                <strong>Your field notes</strong>
              </span>
            </span>
          </div>
        </>
      ) : null}

      {kind === 'finish' ? (
        <div className="chapter-preview">
          <div className="chapter-preview-photos">
            <span data-tone="coast" />
            <span data-tone="city" />
            <span data-tone="trail" />
          </div>
          <div className="chapter-preview-copy">
            <small>Private journey</small>
            <strong>Coastal weekend</strong>
            <span>
              <CalendarDaysIcon /> May 18–21 · 12 memories
            </span>
          </div>
          <div className="chapter-preview-meta">
            <LockClosedIcon />
            <span>
              <strong>1 private journey</strong>
              <small>Only you can see it</small>
            </span>
            <BookOpenIcon />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FeaturedBridges() {
  return (
    <section
      id="memory-creation"
      className="featured-section"
      aria-labelledby="featured-title"
    >
      <div className="section-heading">
        <p>Memory creation · 01</p>
        <h2 id="featured-title">From one place to a mapped Journey.</h2>
        <p className="section-description">
          Start with one meaningful place, keep the whole Memory together, and
          connect it to the Journeys that tell your story.
        </p>
      </div>

      <ol className="bridge-grid">
        {features.map((feature) => (
          <li className="bridge-card" key={feature.name}>
            <FeaturePreview kind={feature.kind} index={feature.index} />
            <div className="bridge-card-copy feature-card-copy">
              <div>
                <p className="bridge-location">
                  Step {feature.index} · {feature.label}
                </p>
                <h3>{feature.name}</h3>
              </div>
              <p>{feature.description}</p>
              <span className="feature-detail">
                <CheckCircleIcon aria-hidden="true" />
                {feature.detail}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
