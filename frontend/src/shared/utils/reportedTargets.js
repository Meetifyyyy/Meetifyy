/**
 * What this person has already reported, for as long as the page lives.
 *
 * The media viewer used to remember "already reported" as one boolean on a viewer
 * that never unmounts, so after reporting one thing every unrelated item said
 * "Already reported" and could not be reported. The answer belongs to the thing
 * reported: the key is `${targetType}:${targetId}`.
 *
 * Kept outside React on purpose - it must outlive a viewer session, so reopening
 * the same media still knows - and cleared when the account signs out, since the
 * next person on this page has reported nothing.
 */
const reported = new Set();

export const reportKey = (target) => `${target.targetType}:${target.targetId}`;
export const hasReportedTarget = (key) => reported.has(key);
export const markTargetReported = (key) => { reported.add(key); };
export const clearReportedTargets = () => { reported.clear(); };
