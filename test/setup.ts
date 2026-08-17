import '@testing-library/jest-dom';

if (typeof window !== 'undefined') {
  window.requestAnimationFrame ??= (callback) =>
    window.setTimeout(() => callback(performance.now()), 0);
  window.cancelAnimationFrame ??= (handle) => window.clearTimeout(handle);
  window.matchMedia ??= (query) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }) as MediaQueryList;
  window.scrollTo = jest.fn();
}
