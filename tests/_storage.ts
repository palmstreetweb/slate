/**
 * Where `localStorage.getItem` / `setItem` live, so `vi.spyOn` replaces the
 * one the app calls. jsdom puts them on Storage.prototype (Node 22, 24); the
 * in-memory storage `setup.ts` installs on Node 25+ has them on the object.
 */
export function storageWith(method: 'getItem' | 'setItem'): Storage {
  const storage = window.localStorage;
  return Object.prototype.hasOwnProperty.call(storage, method)
    ? storage
    : (Object.getPrototypeOf(storage) as Storage);
}
