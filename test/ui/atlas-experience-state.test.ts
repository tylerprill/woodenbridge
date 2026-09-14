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

  it('keeps builder selection ordered and unique', () => {
    let state = atlasExperienceReducer(
      { mode: 'journeys', surface: 'overview' },
      {
        type: 'start-builder',
        selectedEntryIds: ['first', 'first', 'second'],
      },
    );
    state = atlasExperienceReducer(state, {
      type: 'toggle-builder-entry',
      entryId: 'third',
    });
    state = atlasExperienceReducer(state, {
      type: 'move-builder-entry',
      entryId: 'third',
      direction: -1,
    });

    expect(state).toEqual({
      mode: 'journeys',
      surface: 'builder',
      selectedEntryIds: ['first', 'third', 'second'],
    });
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

  it('enforces the Chapter memory limit for every builder entry path', () => {
    const ids = Array.from({ length: 55 }, (_, index) => `memory-${index}`);
    const state = atlasExperienceReducer(
      { mode: 'journeys', surface: 'overview' },
      { type: 'start-builder', selectedEntryIds: ids },
    );
    const withAnother = atlasExperienceReducer(state, {
      type: 'toggle-builder-entry',
      entryId: 'one-more',
    });

    expect(state).toMatchObject({ selectedEntryIds: ids.slice(0, 50) });
    expect(withAnother).toEqual(state);
  });
});
