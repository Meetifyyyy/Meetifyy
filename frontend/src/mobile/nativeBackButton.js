/**
 * Decides what Android's back press means.
 *
 * Separate from `main.jsx` because this is the one piece of native navigation
 * with an actual decision in it, and a decision that is wrong in a way nobody
 * notices until it is on a device is worth a test. `main.jsx` is wiring; this
 * is behaviour.
 *
 * THE RULE
 * If the WebView has somewhere to go back to, go there. If it does not, the
 * user is at the front door and pressing back means "leave", which on Android
 * means closing the app — not sitting on a screen that ignores the gesture.
 *
 * `canGoBack` comes from the WebView rather than from the router. The router's
 * history and the WebView's are the same history, because the router pushes
 * through the History API; asking the WebView avoids keeping a second count
 * that can drift from the first.
 *
 * NOT HANDLED YET, DELIBERATELY
 * An open overlay — the media viewer, a bottom sheet — should swallow the first
 * back press and close itself instead of navigating. That needs the overlay
 * layer to publish "something is open", which it does not today, and inventing
 * it here would put navigation logic inside a file that should only route the
 * press. Tracked as a follow-up rather than guessed at.
 */

/**
 * @param {{ onPress: Function, exitApp: Function }} backButton
 * @param {{ goBack?: () => void, exit?: () => void }} [deps]
 * @returns {() => void} unsubscribe
 */
export function installNativeBackButton(backButton, deps = {}) {
  if (!backButton) return () => {};

  const goBack = deps.goBack ?? (() => window.history.back());
  const exit = deps.exit ?? (() => backButton.exitApp());

  return backButton.onPress(({ canGoBack }) => {
    if (canGoBack) {
      goBack();
    } else {
      exit();
    }
  });
}

export default installNativeBackButton;
