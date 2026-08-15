export type SavedBridge = {
  description: string;
  location: string;
  name: string;
  note: string;
  status: 'Visited' | 'Want to visit';
  tone: 'alpine' | 'cedar' | 'ember';
};

export const savedBridges: SavedBridge[] = [
  {
    name: 'Kintai Bridge',
    location: 'Iwakuni, Japan',
    description:
      'Five timber arches moving in rhythm across the Nishiki River.',
    note: 'Best approached at first light, before the river walk grows busy.',
    status: 'Want to visit',
    tone: 'cedar',
  },
  {
    name: 'Kapellbrücke',
    location: 'Lucerne, Switzerland',
    description:
      'A covered crossing carrying painted stories through the center of town.',
    note: 'Walk the bridge slowly and look up—the story is above you.',
    status: 'Visited',
    tone: 'alpine',
  },
  {
    name: 'Humpback Bridge',
    location: 'Virginia, United States',
    description:
      'A singular arched covered bridge in a quiet Appalachian valley.',
    note: 'Pair the crossing with a slow drive through the surrounding valley.',
    status: 'Want to visit',
    tone: 'ember',
  },
];
