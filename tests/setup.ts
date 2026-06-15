import '@testing-library/jest-dom/vitest';

// Node 25 ships an experimental global `localStorage` that is undefined
// unless --localstorage-file is passed, and it shadows jsdom's
// implementation in the vitest environment. Install a simple in-memory
// Storage so theme-persistence code paths are testable.
function makeMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store = new Map();
    },
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
}

if (typeof window !== 'undefined') {
  const probe = (): boolean => {
    try {
      const k = '__slate_storage_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  };
  if (!window.localStorage || !probe()) {
    Object.defineProperty(window, 'localStorage', {
      value: makeMemoryStorage(),
      writable: false,
      configurable: true,
    });
  }
}

// jsdom doesn't implement matchMedia; useTheme/useReducedMotion need it for
// full <Form> renders. Minimal always-false implementation with listener API.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
