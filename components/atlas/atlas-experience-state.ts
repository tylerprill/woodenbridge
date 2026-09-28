export type AtlasMode = 'places' | 'journeys';

export type AtlasExperience =
  | { mode: 'places'; surface: 'overview' | 'placing' | 'memory-list' }
  | { mode: 'places'; surface: 'memory'; entryId: string }
  | { mode: 'journeys'; surface: 'overview' }
  | {
      mode: 'journeys';
      surface: 'detail';
      journeyId: string;
      stopId: string | null;
    }
  | {
      mode: 'journeys';
      surface: 'playback';
      journeyId: string;
      stopIndex: number;
      playing: boolean;
    };

export type AtlasExperienceAction =
  | { type: 'switch-mode'; mode: AtlasMode }
  | { type: 'show-overview' }
  | { type: 'start-placement' }
  | { type: 'open-memory-list' }
  | { type: 'open-memory'; entryId: string }
  | { type: 'select-journey'; journeyId: string; stopId?: string | null }
  | { type: 'select-journey-stop'; stopId: string | null }
  | { type: 'start-playback'; journeyId: string; stopIndex?: number }
  | { type: 'set-playback-stop'; stopIndex: number; playing?: boolean }
  | { type: 'set-playback-playing'; playing: boolean }
  | { type: 'exit-playback' };

export function atlasExperienceReducer(
  state: AtlasExperience,
  action: AtlasExperienceAction,
): AtlasExperience {
  switch (action.type) {
    case 'switch-mode':
      return action.mode === 'places'
        ? { mode: 'places', surface: 'overview' }
        : { mode: 'journeys', surface: 'overview' };
    case 'show-overview':
      return state.mode === 'places'
        ? { mode: 'places', surface: 'overview' }
        : { mode: 'journeys', surface: 'overview' };
    case 'start-placement':
      return { mode: 'places', surface: 'placing' };
    case 'open-memory-list':
      return { mode: 'places', surface: 'memory-list' };
    case 'open-memory':
      return { mode: 'places', surface: 'memory', entryId: action.entryId };
    case 'select-journey':
      return {
        mode: 'journeys',
        surface: 'detail',
        journeyId: action.journeyId,
        stopId: action.stopId ?? null,
      };
    case 'select-journey-stop':
      return state.mode === 'journeys' && state.surface === 'detail'
        ? { ...state, stopId: action.stopId }
        : state;
    case 'start-playback':
      return {
        mode: 'journeys',
        surface: 'playback',
        journeyId: action.journeyId,
        stopIndex: Math.max(0, Math.trunc(action.stopIndex ?? 0)),
        playing: false,
      };
    case 'set-playback-stop':
      return state.mode === 'journeys' && state.surface === 'playback'
        ? {
            ...state,
            stopIndex: Math.max(0, Math.trunc(action.stopIndex)),
            playing: action.playing ?? false,
          }
        : state;
    case 'set-playback-playing':
      return state.mode === 'journeys' && state.surface === 'playback'
        ? { ...state, playing: action.playing }
        : state;
    case 'exit-playback':
      return state.mode === 'journeys' && state.surface === 'playback'
        ? {
            mode: 'journeys',
            surface: 'detail',
            journeyId: state.journeyId,
            stopId: null,
          }
        : state;
  }
}
