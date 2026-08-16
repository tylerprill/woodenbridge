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
    name: 'Fushimi Inari at Dawn',
    location: 'Kyoto, Japan',
    description:
      'A quiet climb through vermilion gates before the city began to stir.',
    note: 'Arrive before sunrise and let the trail set the pace for the day.',
    status: 'Visited',
    tone: 'cedar',
  },
  {
    name: 'Lake Lucerne Morning',
    location: 'Lucerne, Switzerland',
    description:
      'Still water, mountain air, and the first clear morning of the journey.',
    note: 'Save time for the lakeside walk before the old town grows busy.',
    status: 'Visited',
    tone: 'alpine',
  },
  {
    name: 'Cathedral Rock Trail',
    location: 'Sedona, Arizona',
    description:
      'A red-rock trail turning gold as the final light reaches the canyon.',
    note: 'Pack water, start late in the afternoon, and stay for the color.',
    status: 'Want to visit',
    tone: 'ember',
  },
];
