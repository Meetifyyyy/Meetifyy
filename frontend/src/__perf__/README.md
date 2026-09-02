# Render-cost harness

Mounts the real Home feed and Post View — the actual components, the real
React Query cache, the real contexts — under a React `Profiler`, and reports how
many components genuinely re-render for each interaction.

```bash
npm run perf
```

It exists because "interacting with one post must not re-render the feed" is a
claim that has to be checkable. Each scenario prints a line; the numbers that
matter are the *counts*, which are deterministic. The millisecond figures come
from jsdom and are useful only for comparing a before and an after on the same
machine, never as absolute timings.

## What the counters actually count

`React.memo` wrappers render even when the memo bails, so counting the exported
component overstates the work. Each scenario instead counts a component that
sits **inside** the memo boundary and renders exactly once per real render:

- feed: `PostActions` and `MediaGrid`, both inside `memo(Post)`
- comments: `RichText`, rendered once per comment body

`CommentTreeRoot` and `CommentNode` live in one module, so mocking that module
cannot intercept the tree's own recursion — hence `RichText`.

## Baseline these replaced (2026-09-03)

| Scenario | Before | After |
|---|---|---|
| Open media viewer -> posts re-rendered | 16 of 16 | 0 |
| Like 1 comment -> comment bodies re-rendered (60-node thread) | 61 of 61 | 2 |
| Open 1 reply box -> comment bodies re-rendered | 61 of 61 | 0 |
| `ReportModal` instances mounted for a 60-comment thread | 60 | 0 |
| Like / save 1 post -> posts re-rendered | 1 | 1 (already correct) |
