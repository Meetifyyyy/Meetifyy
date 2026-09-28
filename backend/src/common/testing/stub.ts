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

/**
 * A partial T, at any depth. A method may be a jest mock, or a function whose
 * result is itself partial — `switchToHttp: () => ({ getRequest: () => req })`
 * stands in for an ExecutionContext without spelling out every member, and
 * each name along the way is still checked against the real type.
 */
export type Stub<T> = {
  [K in keyof T]?: T[K] extends (...args: infer A) => infer R
    ? T[K] | jest.Mock | ((...args: A) => StubResult<R>)
    : T[K] extends object
      ? Stub<T[K]>
      : T[K];
};

/** What a stubbed method may return: a partial of the real result. */
type StubResult<R> =
  R extends Promise<infer U>
    ? Promise<StubResult<U>>
    : R extends (...args: never[]) => unknown
      ? R
      : R extends object
        ? Stub<R>
        : R;

/** A partial dependency, typed as the real one for the code under test. */
export function stub<T>(members: Stub<T> = {}): T {
  return members as unknown as T;
}
