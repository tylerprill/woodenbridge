import {
  atlasExperienceReducer,
  type AtlasExperience,
} from '@/components/atlas/atlas-experience-state';

describe('Atlas experience state', () => {
  it('clears incompatible place state when Journeys opens', () => {
    const state: AtlasExperience = { mode: 'places', surface: 'placing' };

    expect(
      atlasExperienceReducer(state, {
        type: 'switch-mode',
        mode: 'journeys',
      }),
    ).toEqual({ mode: 'journeys', surface: 'overview' });
  });

  it('returns playback to the selected journey without losing context', () => {
    const playback = atlasExperienceReducer(
      { mode: 'journeys', surface: 'overview' },
      { type: 'start-playback', journeyId: 'chapter', stopIndex: 2 },
    );

    expect(atlasExperienceReducer(playback, { type: 'exit-playback' })).toEqual(
      {
        mode: 'journeys',
        surface: 'detail',
        journeyId: 'chapter',
        stopId: null,
      },
    );
  });
});
