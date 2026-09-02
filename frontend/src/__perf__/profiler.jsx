import { Profiler } from 'react';

/**
 * Counts commits and accumulates actualDuration per profiled id.
 * Mirrors what the React DevTools Profiler flamegraph reports.
 */
export function createRecorder() {
  const rows = new Map();
  const onRender = (id, phase, actualDuration, baseDuration) => {
    const r = rows.get(id) || { id, mounts: 0, updates: 0, actual: 0, base: 0 };
    if (phase === 'mount') r.mounts++; else r.updates++;
    r.actual += actualDuration;
    r.base += baseDuration;
    rows.set(id, r);
  };
  return {
    onRender,
    reset: () => rows.clear(),
    get: (id) => rows.get(id) || { id, mounts: 0, updates: 0, actual: 0, base: 0 },
    all: () => Array.from(rows.values()),
  };
}

export function Profiled({ id, recorder, children }) {
  return <Profiler id={id} onRender={recorder.onRender}>{children}</Profiler>;
}

/** Instrument a component so every one of its renders is counted by name. */
export function countRenders(Component, counter, name) {
  const label = name || Component.displayName || Component.name || 'anon';
  function Counting(props) {
    counter[label] = (counter[label] || 0) + 1;
    return <Component {...props} />;
  }
  Counting.displayName = `Counting(${label})`;
  return Counting;
}
