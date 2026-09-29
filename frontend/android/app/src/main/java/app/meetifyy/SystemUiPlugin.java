package app.meetifyy;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;

import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

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
            editor.commit();

            // Persisting only. Neither the window's colour (it follows the
            // page's bottom edge: setWindowColor) nor the bars' icons (they
            // follow what is under them: setIcons) is set here, because this
            // call would put the theme's values back over the page's.

            // No AppCompatDelegate.setDefaultNightMode() here. The UI is the
            // WebView, which already has the theme; switching the native night
            // mode at runtime only produced a configuration change whose
            // handler repainted from the preferences as they were BEFORE this
            // call — the old theme — racing the page. The native night mode is
            // applied from the preferences above at the next launch
            // (MainActivity.onCreate), which is the only time native resources
            // (the splash) are drawn.

            call.resolve();
        });
    }

    /**
     * Keeps the window (and the WebView's own background) the colour of the
     * page's bottom edge.
     *
     * The window shows in exactly one situation once the page is up: the soft
     * keyboard. The WebView is shrunk to the space above it at once, and the
     * keyboard then slides in over roughly a quarter of a second, so for that
     * long a strip above the keyboard is window rather than page. In the
     * theme's colour it was a white patch flashing across a dark screen. In the
     * colour of the page's bottom edge it reads as the page continuing down
     * behind the keyboard. Not persisted: this follows the page, and the theme
     * colour for the next cold start is `setColors`'.
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
            SystemUiHelper.setWindowColor(activity, color);
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setBackgroundColor(color);
            }
            call.resolve();
        });
    }

    /**
     * Icon appearance only. Called on every change of the page's edge colours,
     * so it does nothing else: no preferences, no window repaint.
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
            SystemUiHelper.setBarIcons(activity, statusLight, navLight);
            call.resolve();
        });
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
     * its own controls clear of them. The one exception is the soft keyboard:
     * that still shrinks the WebView, because the keyboard is opaque and the
     * page has nothing to draw under it.
     */

    private int lastTop = 0;
    private int lastBottom = 0;
    private boolean published = false;

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
            final Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            final boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());

            // Sides for a landscape cutout / side navigation; the bottom is
            // the keyboard only. The WebView is shrunk to its final size at
            // once, so for the length of the keyboard's slide the strip above
            // the keyboard is not the WebView but the window behind it — which
            // is why the window is kept the colour of the page's bottom edge
            // (see setWindowColor) rather than the theme's.
            v.setPadding(bars.left, 0, bars.right, keyboardVisible ? ime.bottom : 0);

            final float density = activity.getResources().getDisplayMetrics().density;
            // With the keyboard up the WebView ends at the keyboard's top edge,
            // so the navigation bar is not under any of the page.
            publish(Math.round(bars.top / density), keyboardVisible ? 0 : Math.round(bars.bottom / density));

            // Zeroed rather than CONSUMED, as Capacitor does, so the WebView keeps
            // recalculating its own safe-area values (chromium issue 461332423).
            return new WindowInsetsCompat.Builder(insets).setInsets(types, Insets.of(0, 0, 0, 0)).build();
        });

        ViewCompat.requestApplyInsets(decor);
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
