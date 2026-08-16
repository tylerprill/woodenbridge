import { ArrowUpRightIcon, MapPinIcon } from '@heroicons/react/24/outline';

import { BridgeScene } from '@/components/clean/bridge-scene';

const bridges = [
  {
    index: '01',
    name: 'Morning in Kyoto',
    location: 'Kyoto, Japan',
    description:
      'A quiet climb through vermilion gates before the city began to stir.',
    tone: 'cedar',
  },
  {
    index: '02',
    name: 'Lake Lucerne in Blue',
    location: 'Lucerne, Switzerland',
    description:
      'Still water, mountain air, and the first clear morning of the journey.',
    tone: 'alpine',
  },
  {
    index: '03',
    name: 'Red Rock Afternoon',
    location: 'Sedona, Arizona',
    description:
      'A dusty trail turning gold as the last light reached the canyon walls.',
    tone: 'ember',
  },
];

export function FeaturedBridges() {
  return (
    <section
      id="featured"
      className="featured-section"
      aria-labelledby="featured-title"
    >
      <div className="section-heading">
        <p>Selected memories · 01</p>
        <h2 id="featured-title">Moments worth keeping.</h2>
        <span>
          A glimpse of the places, photographs, and stories that shape an atlas.
        </span>
      </div>

      <div className="bridge-grid">
        {bridges.map((bridge) => (
          <article className="bridge-card" key={bridge.name}>
            <BridgeScene
              index={bridge.index}
              tone={bridge.tone as 'alpine' | 'cedar' | 'ember'}
            />
            <div className="bridge-card-copy">
              <div>
                <p className="bridge-location">
                  <MapPinIcon aria-hidden="true" />
                  {bridge.location}
                </p>
                <h3>{bridge.name}</h3>
              </div>
              <ArrowUpRightIcon
                className="bridge-card-arrow"
                aria-hidden="true"
              />
              <p>{bridge.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
