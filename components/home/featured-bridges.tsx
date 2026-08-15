import { ArrowUpRightIcon, MapPinIcon } from '@heroicons/react/24/outline';

import { BridgeScene } from '@/components/clean/bridge-scene';

const bridges = [
  {
    index: '01',
    name: 'Kintai Bridge',
    location: 'Iwakuni, Japan',
    description:
      'Five timber arches rise and fall in rhythm with the Nishiki River.',
    tone: 'cedar',
  },
  {
    index: '02',
    name: 'Kapellbrücke',
    location: 'Lucerne, Switzerland',
    description:
      'A covered crossing that carries centuries of paintings over the Reuss.',
    tone: 'alpine',
  },
  {
    index: '03',
    name: 'Humpback Bridge',
    location: 'Virginia, United States',
    description:
      'A rare arched covered bridge tucked into a quiet Appalachian valley.',
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
        <p>Selected crossings · 01</p>
        <h2 id="featured-title">Three reasons to take the long way.</h2>
        <span>
          A starting point for wandering—chosen for craft, setting, and story.
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
