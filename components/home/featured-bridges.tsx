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
    name: 'Bring in the whole trip.',
    label: 'Choose your photos',
    description:
      'Select a camera-roll batch instead of building memories one pin at a time. The captured order stays intact.',
    detail: 'JPG, PNG, WebP, and HEIC',
    kind: 'select' as const,
  },
  {
    index: '02',
    name: 'Review only what needs you.',
    label: 'Recognized for you',
    description:
      'Places and captured dates are prepared automatically. Clear matches move forward while exceptions stay visible.',
    detail: '2 brought forward for review',
    kind: 'recognize' as const,
  },
  {
    index: '03',
    name: 'Keep memories or shape a chapter.',
    label: 'Finish your way',
    description:
      'Add only the titles and field notes that matter, then save private memories or gather the trip into one chapter.',
    detail: 'Everything remains editable',
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
        <span>Example import</span>
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
              <small>Ready to import</small>
              <strong>12 photos selected</strong>
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
                <small>Ready</small>
                <strong>10 places recognized</strong>
              </span>
            </span>
            <span data-review="true">
              <ExclamationTriangleIcon />
              <span>
                <small>Needs you</small>
                <strong>2 photos to review</strong>
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
            <small>Private chapter</small>
            <strong>Coastal weekend</strong>
            <span>
              <CalendarDaysIcon /> May 18–21 · 12 memories
            </span>
          </div>
          <div className="chapter-preview-meta">
            <LockClosedIcon />
            <span>
              <strong>1 private chapter</strong>
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
      id="photo-upload"
      className="featured-section"
      aria-labelledby="featured-title"
    >
      <div className="section-heading">
        <p>Photo upload · 01</p>
        <h2 id="featured-title">From camera roll to mapped journey.</h2>
        <p className="section-description">
          The repetitive work happens quietly. You stay in control of every
          place, detail, and final memory.
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
