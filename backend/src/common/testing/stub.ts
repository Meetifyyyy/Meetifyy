/**
 * Stand-ins for constructor dependencies in specs.
 *
 * A spec that exercises one method of a service hands the rest of its
 * dependencies partial objects. Typed as `any`, those compile whatever they
 * contain: a renamed method on the real service leaves the spec calling a
 * mock that nothing else calls, and the test keeps passing for the wrong
 * reason. `stub<T>()` checks every member name against the real type, so that
 * rename is a compile error in the spec, and hands the constructor a value of
 * type T, so no `as any` is needed where it is passed.
 *
 * The one cast from a partial object to the full type lives here.
 */

/** A partial T whose methods may be replaced by jest mocks, at any depth. */
export type Stub<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K] | jest.Mock
    : T[K] extends object
      ? Stub<T[K]>
      : T[K];
};

/** A partial dependency, typed as the real one for the code under test. */
export function stub<T>(members: Stub<T> = {}): T {
  return members as unknown as T;
}
