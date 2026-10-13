package app.meetifyy;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;

import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
import java.util.Locale;

/**
 * The window's side of the system bars.
 *
 * The bars themselves are transparent for the life of the activity and the
 * WebView is laid out beneath them (see {@link SystemUiHelper#applySystemBars}),
 * so this plugin does three small things and none of them paints a bar:
 *
 * 1. publishes the bars' heights to the page as CSS custom properties, which is
 *    how the page knows how much of its edge the bars cover;
 * 2. sets the bar ICON appearance (light or dark), the one thing the page
 *    cannot draw;
 * 3. persists the user's theme into SharedPreferences so MainActivity can
 *    resolve it on the next cold start, before any UI or splash is drawn.
 */
@CapacitorPlugin(name = "SystemUi")
public class SystemUiPlugin extends Plugin {

    public static final String PREFS = SystemUiHelper.PREFS;
    public static final String KEY_BACKGROUND = SystemUiHelper.KEY_BACKGROUND;

    /**
     * @param call `background`: CSS hex colour of the theme's chrome (persisted for the next launch)
     *             `lightIcons`: true when icons must be light (dark background)
     *             `theme`: optional "light", "dark", or "system"
     *             `preferenceSet`: optional boolean indicating explicit user choice
     */
    @PluginMethod
    public void setColors(PluginCall call) {
        final String background = call.getString("background");
        final boolean lightIcons = Boolean.TRUE.equals(call.getBoolean("lightIcons", false));
        final String theme = call.getString("theme", null);
        final Boolean preferenceSet = call.getBoolean("preferenceSet", null);

        if (background == null || background.isEmpty()) {
            call.reject("background is required");
            return;
        }

        final int color;
        try {
            color = Color.parseColor(background);
        } catch (IllegalArgumentException e) {
            call.reject("unparseable colour: " + background);
            return;
        }

        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }

        activity.runOnUiThread(() -> {
            // Persisted FIRST and synchronously: this is what the next cold
            // start's splash and launch background are drawn from.
            final SharedPreferences prefs =
                activity.getSharedPreferences(SystemUiHelper.PREFS, Activity.MODE_PRIVATE);

            // Nothing to write is the common case: the page sends this on every
            // launch with the values the previous launch already stored. A
            // commit() is an fsync on the UI thread while the splash is held,
            // so it is skipped unless a value actually differs. Reads come from
            // the in-memory copy and cost nothing.
            final boolean wantPreferenceSet = Boolean.TRUE.equals(preferenceSet);
            final boolean clearPreferenceSet = !wantPreferenceSet && "system".equalsIgnoreCase(theme);
            final boolean unchanged =
                prefs.contains(SystemUiHelper.KEY_BACKGROUND)
                    && prefs.getInt(SystemUiHelper.KEY_BACKGROUND, 0) == color
                    && prefs.contains(SystemUiHelper.KEY_LIGHT_ICONS)
                    && prefs.getBoolean(SystemUiHelper.KEY_LIGHT_ICONS, false) == lightIcons
                    && (theme == null || theme.equals(prefs.getString(SystemUiHelper.KEY_THEME, null)))
                    && (!wantPreferenceSet || prefs.getBoolean(SystemUiHelper.KEY_PREFERENCE_SET, false))
                    && (!clearPreferenceSet
                        || (prefs.contains(SystemUiHelper.KEY_PREFERENCE_SET)
                            && !prefs.getBoolean(SystemUiHelper.KEY_PREFERENCE_SET, false)));
            if (unchanged) {
                call.resolve();
                return;
            }

            final SharedPreferences.Editor editor = prefs.edit();
            editor.putInt(SystemUiHelper.KEY_BACKGROUND, color);
            editor.putBoolean(SystemUiHelper.KEY_LIGHT_ICONS, lightIcons);
            if (theme != null) {
                editor.putString(SystemUiHelper.KEY_THEME, theme);
            }
            if (Boolean.TRUE.equals(preferenceSet)) {
                editor.putBoolean(SystemUiHelper.KEY_PREFERENCE_SET, true);
            } else if ("system".equalsIgnoreCase(theme)) {
                editor.putBoolean(SystemUiHelper.KEY_PREFERENCE_SET, false);
            }
            // commit() is an fsync on the UI thread. During a theme reveal that
            // stalled the circle for frames; apply() writes in the background
            // (the values are in memory at once, and Android flushes pending
            // writes before the app is stopped).
            if (SystemUiHelper.iconsHeld()) {
                editor.apply();
            } else {
                editor.commit();
            }

            // The next cold start's splash is drawn by the system, from the night
            // mode it holds for the app (SystemUiHelper.syncSystemNightMode).
            // That is NOT synced here any more: it is a configuration change
            // on the running activity, and this call arrives in the middle of
            // the theme reveal (ThemeRevealPlugin) — the system re-tinted the
            // bars' icons and the WebView re-evaluated its colour scheme while
            // the circle was growing. Only the next cold start needs it, so
            // MainActivity.onStop syncs it from the preferences committed
            // above when the app leaves the screen.

            // Persisting only. Neither the window's colour (it follows the
            // page's bottom edge: setWindowColor) nor the bars' icons (they
            // follow what is under them: setIcons) is set here, because this
            // call would put the theme's values back over the page's.

            // No AppCompatDelegate.setDefaultNightMode() here: the UI is the
            // WebView, which already has the theme. The system's night mode for
            // the app follows in onStop (above).

            call.resolve();
        });
    }

    /**
     * Keeps the window (and the WebView's own background) the colour of the
     * page's bottom edge.
     *
     * The window used to show while the soft keyboard resized the WebView: a
     * strip above the sliding keyboard was window rather than page, and in the
     * theme's colour it was a white patch flashing across a dark screen. The
     * keyboard now overlays the page and the WebView never resizes for it, so
     * that strip is gone; this is kept so anything that does expose the window
     * (a WebView relayout, an OEM quirk) reads as the page continuing. Not
     * persisted: this follows the page, and the theme colour for the next cold
     * start is `setColors`'.
     *
     * @param call `color`: CSS hex colour
     */
    @PluginMethod
    public void setWindowColor(PluginCall call) {
        final String value = call.getString("color");
        final int color;
        try {
            color = Color.parseColor(value);
        } catch (IllegalArgumentException | NullPointerException e) {
            call.reject("unparseable colour: " + value);
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() -> {
            // Held until a theme reveal has finished (SystemUiHelper.runWhenRevealEnds).
            SystemUiHelper.runWhenRevealEnds("windowColor", () -> {
                if (activity.isFinishing()) return;
                SystemUiHelper.setWindowColor(activity, color);
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().setBackgroundColor(color);
                }
            });
            call.resolve();
        });
    }

    /**
     * Icon appearance only. Called on every change of the page's edge colours,
     * so it does nothing else: no preferences, no window repaint.
     *
     * While a theme reveal is on screen the request is remembered but not
     * applied: the reveal applies it to each bar as its circle reaches that
     * bar, and applies the latest one when it ends (SystemUiHelper.setPageIcons).
     * The page does not need to know; it calls this exactly as before.
     *
     * @param call `statusLightIcons`: light status-bar icons (over a dark edge)
     *             `navLightIcons`: light navigation-bar icons
     */
    @PluginMethod
    public void setIcons(PluginCall call) {
        final boolean statusLight = Boolean.TRUE.equals(call.getBoolean("statusLightIcons", false));
        final boolean navLight = Boolean.TRUE.equals(call.getBoolean("navLightIcons", false));
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() -> {
            SystemUiHelper.setPageIcons(activity, statusLight, navLight);
            call.resolve();
        });
    }

    /**
     * The page is ready and has painted: lift the splash now.
     *
     * MainActivity also polls for readiness with evaluateJavascript, but that
     * call is queued behind the page's main thread — which, the moment auth is
     * decided, is busy mounting the shell and rendering the feed. Measured on a
     * device the poll saw readiness ~500 ms after the page had set it, all of it
     * spent behind a splash covering an already-painted screen. A plugin call is
     * posted to the native side as it is made, so it does not wait for that
     * work. The poll stays as the fallback.
     *
     * @param call `theme`: "dark" or "light", the theme the page booted in, so
     *             the window behind it is corrected exactly as the poll would.
     */
    @PluginMethod
    public void appReady(PluginCall call) {
        final String theme = call.getString("theme", "");
        final Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            final MainActivity main = (MainActivity) activity;
            activity.runOnUiThread(() -> main.onPageReady(theme));
        }
        call.resolve();
    }

    /** The bars' current heights, in CSS px. Lets the page fill its own layout before the first paint. */
    @PluginMethod
    public void getInsets(PluginCall call) {
        final JSObject result = new JSObject();
        result.put("top", lastTop);
        result.put("bottom", lastBottom);
        call.resolve(result);
    }

    /*
     * ── Insets ─────────────────────────────────────────────────────────────
     *
     * Capacitor's SystemBars pads the decor view by the system-bar insets (that
     * padding is why the WebView used to stop above the navigation buttons), so
     * this plugin takes over that listener: no padding for the bars, on any
     * edge, so the WebView runs edge to edge. The bars' heights go to the page
     * as `--status-bar-inset` and `--navigation-bar-inset`, and the page keeps
     * its own controls clear of them.
     *
     * The soft keyboard OVERLAYS the page. It used to shrink the WebView (the
     * decor was padded by the IME inset, frame by frame during the slide), and
     * every resize step cost the page 60-90 ms on its main thread: a restyle of
     * the whole document for each custom property that changed with the
     * viewport, height media queries flipping, viewport units re-resolving.
     * Only three or four heights reached the page in a ~300 ms slide, so it was
     * steppy, and on close the uncovered strip was blank for ~5 frames. Now the
     * WebView keeps its size and the page is told about the keyboard ONCE per
     * transition, at the START of the IME animation (`meetifyy:ime`, below), and
     * lifts its own bottom-docked UI with a compositor transform that runs on
     * the IME's own duration and curve.
     */

    private int lastTop = 0;
    private int lastBottom = 0;
    private boolean published = false;

    // An IME animation has been prepared and has not started yet: the insets
    // dispatched in between are its END state, published from onStart.
    private boolean imePrepared = false;
    private boolean pendingImeVisible = false;
    private int pendingImeHeight = 0;
    // What the page was last told, so a re-dispatch of the same insets (every
    // requestApplyInsets, onEnd) sends nothing.
    private boolean imePublished = false;
    private boolean lastImeVisible = false;
    private int lastImeHeight = 0;

    @Override
    public void load() {
        super.load();
        // Posted so it runs after every plugin's load(), including SystemBars,
        // whose own listener on the same view this replaces.
        final Activity activity = getActivity();
        if (activity != null) {
            activity.getWindow().getDecorView().post(this::installInsetsListener);
        }
        // A new document (the first load, a reload) has none of the custom
        // properties set on the previous one, and the insets have not changed,
        // so nothing would republish them.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                published = false;
                // A new document has no keyboard state either.
                imePublished = false;
                lastImeVisible = false;
                lastImeHeight = 0;
                final Activity a = getActivity();
                if (a != null) ViewCompat.requestApplyInsets(a.getWindow().getDecorView());
            }
        });
    }

    /**
     * Capacitor's SystemBars registers its own listener on the same view, and
     * a view has one listener: whichever registered last wins. It registers at
     * load and may do so again later, so installing ours once was not enough.
     * Ours is therefore (re)installed at every point where that could have
     * happened. Re-installing is idempotent: same listener logic, one
     * re-dispatch.
     */
    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        final Activity activity = getActivity();
        if (activity != null) activity.getWindow().getDecorView().post(this::installInsetsListener);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        final Activity activity = getActivity();
        if (activity != null) activity.getWindow().getDecorView().post(this::installInsetsListener);
    }

    private void installInsetsListener() {
        final Activity activity = getActivity();
        if (activity == null) return;

        final View decor = activity.getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            final int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            final Insets bars = insets.getInsets(types);

            // Sides only, for a landscape cutout / side navigation. Never the
            // bottom: the keyboard no longer resizes the WebView (see above).
            if (v.getPaddingLeft() != bars.left || v.getPaddingTop() != 0
                || v.getPaddingRight() != bars.right || v.getPaddingBottom() != 0) {
                v.setPadding(bars.left, 0, bars.right, 0);
            }

            final float density = activity.getResources().getDisplayMetrics().density;
            // The navigation bar's height even while the keyboard is up: the
            // WebView still reaches the bottom of the screen, under both. (It
            // used to drop to 0 with the keyboard, a restyle of every element
            // on the page in the middle of the slide.)
            publish(Math.round(bars.top / density), Math.round(bars.bottom / density));

            final boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            final int imeHeight = imeHeightCss(insets, density);
            if (imePrepared) {
                // The end state of an animation that has not started: held for
                // onStart, so the page starts moving with the keyboard rather
                // than a frame or more ahead of it.
                pendingImeVisible = imeVisible;
                pendingImeHeight = imeHeight;
            } else {
                // No animation: API < 30 without one, the height changing while
                // the keyboard stays up (emoji panel, another IME, a suggestion
                // strip), rotation, a new document.
                publishIme(imeVisible, imeHeight, 0);
            }

            // Zeroed rather than CONSUMED, as Capacitor does, so the WebView keeps
            // recalculating its own safe-area values (chromium issue 461332423).
            //
            // The IME inset is zeroed too. Given it, the WebView handles the
            // keyboard itself: it shrinks the visual viewport (875 -> 548 on a
            // Pixel-class phone) and fires `resize` ~80 ms BEFORE `meetifyy:ime`
            // can arrive, and the change it makes re-resolves the page's
            // styles (a 67 ms restyle of every element, measured) — the very
            // cost overlay mode exists to remove. The page learns about the
            // keyboard from `meetifyy:ime` instead, and keeps the focused field
            // visible itself (ensureFocusedVisible).
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(types, Insets.of(0, 0, 0, 0))
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 0))
                .build();
        });

        ViewCompat.setWindowInsetsAnimationCallback(decor,
            new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @Override
                public void onPrepare(WindowInsetsAnimationCompat animation) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0) return;
                    imePrepared = true;
                    pendingImeVisible = lastImeVisible;
                    pendingImeHeight = lastImeHeight;
                }

                @Override
                public WindowInsetsAnimationCompat.BoundsCompat onStart(
                    WindowInsetsAnimationCompat animation, WindowInsetsAnimationCompat.BoundsCompat bounds) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0 || !imePrepared) return bounds;
                    imePrepared = false;
                    // Normally the end state arrived through the listener between
                    // onPrepare and here. If it did not, the root insets are it.
                    final WindowInsetsCompat end = ViewCompat.getRootWindowInsets(decor);
                    boolean visible = pendingImeVisible;
                    int height = pendingImeHeight;
                    if (end != null && visible == lastImeVisible && height == lastImeHeight) {
                        visible = end.isVisible(WindowInsetsCompat.Type.ime());
                        height = imeHeightCss(end, activity.getResources().getDisplayMetrics().density);
                    }
                    publishIme(visible, height, animation.getDurationMillis());
                    return bounds;
                }

                // No onProgress work: the page is told once, at the start, and
                // animates on its own. Nothing here runs per frame.
                @Override
                public WindowInsetsCompat onProgress(WindowInsetsCompat insets, List<WindowInsetsAnimationCompat> running) {
                    return insets;
                }

                @Override
                public void onEnd(WindowInsetsAnimationCompat animation) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0) return;
                    // An animation that was prepared but never started (cancelled
                    // before its first frame) must not leave the listener holding
                    // its values back.
                    imePrepared = false;
                    // Settle on the final value through the normal path; if it is
                    // what onStart sent, publishIme sends nothing.
                    ViewCompat.requestApplyInsets(decor);
                }
            });

        ViewCompat.requestApplyInsets(decor);
    }

    /**
     * How much of the bottom of the WebView the keyboard covers, in CSS px.
     *
     * The IME inset is measured from the bottom of the window, which is the
     * bottom of the WebView (it runs edge to edge), so it is exactly that
     * overlap, and it INCLUDES the navigation bar's height (the keyboard covers
     * the bar's area). It is published whole, not minus the bar: that is what
     * --kb-inset means on iOS (innerHeight - visualViewport.height), and what
     * every consumer computes with. A bottom-docked bar that already pads for
     * the navigation bar rises by `--kb-inset - env(safe-area-inset-bottom)`
     * (the app rewrites that env() to --navigation-bar-inset); the keyboard's
     * top edge is at `innerHeight - --kb-inset`. (Publishing it minus the bar
     * was tried: consumers subtracted the bar a second time and the post
     * reply field sat 43 px under the keyboard.)
     */
    private static int imeHeightCss(WindowInsetsCompat insets, float density) {
        final int ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        return ime <= 0 ? 0 : Math.round(ime / density);
    }

    /**
     * Tells the page where the keyboard is going: one event per transition,
     * never per frame. `duration` is the IME animation's (0 for a jump), so the
     * page's own transition can run alongside it.
     */
    private void publishIme(boolean visible, int heightCssPx, long durationMs) {
        // A visible keyboard that overlaps nothing (floating, split) is, for the
        // page, no keyboard.
        if (heightCssPx <= 0) visible = false;
        if (!visible) heightCssPx = 0;
        if (imePublished && visible == lastImeVisible && heightCssPx == lastImeHeight) return;
        final boolean first = !imePublished;
        imePublished = true;
        lastImeVisible = visible;
        lastImeHeight = heightCssPx;
        // The first report of a document with no keyboard says nothing new.
        if (first && !visible) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final String js = String.format(
            Locale.US,
            "window.dispatchEvent(new CustomEvent('meetifyy:ime',{detail:{visible:%b,height:%d,duration:%d,startedAt:%d}}))",
            visible, heightCssPx, Math.max(0, durationMs), System.currentTimeMillis()
        );
        getBridge().executeOnMainThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    /** One script for both values, and none at all when nothing changed. */
    private void publish(int topCssPx, int bottomCssPx) {
        if (published && topCssPx == lastTop && bottomCssPx == lastBottom) return;
        published = true;
        lastTop = topCssPx;
        lastBottom = bottomCssPx;
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final String js = String.format(
            Locale.US,
            "(function(){var s=document.documentElement.style;"
                + "s.setProperty('--status-bar-inset','%dpx');"
                + "s.setProperty('--navigation-bar-inset','%dpx');"
                + "try{localStorage.setItem('meetifyy.insets','%d,%d')}catch(e){}})()",
            topCssPx, bottomCssPx, topCssPx, bottomCssPx
        );
        getBridge().executeOnMainThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }
}
