package app.meetifyy;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;

import android.view.View;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * Paints the status bar and the navigation bar to match the app's own theme.
 *
 * Persists the user's theme selection into SharedPreferences so MainActivity
 * can resolve and apply it on cold start before any UI / splash screen is rendered.
 */
@CapacitorPlugin(name = "SystemUi")
public class SystemUiPlugin extends Plugin {

    public static final String PREFS = SystemUiHelper.PREFS;
    public static final String KEY_BACKGROUND = SystemUiHelper.KEY_BACKGROUND;

    /**
     * @param call `background`: CSS hex color string (e.g. #FFFFFF or #000000)
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
        // Per-bar colours: each bar continues the page edge it meets. Optional;
        // without them both bars take `background`, as before.
        final Integer statusColor = parseOptionalColor(call.getString("statusBackground"));
        final Integer navColor = parseOptionalColor(call.getString("navBackground"));
        final Boolean statusLightIcons = call.getBoolean("statusLightIcons", null);
        final Boolean navLightIcons = call.getBoolean("navLightIcons", null);

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
            final boolean isDark = lightIcons;

            // Persisted FIRST and synchronously: this is what the next cold
            // start's splash and launch background are drawn from. `apply()`
            // wrote it in the background, so a toggle followed quickly by the
            // app being killed launched next time in the old theme.
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

            SystemUiHelper.applySystemBars(
                activity,
                statusColor != null ? statusColor : color,
                statusLightIcons != null ? statusLightIcons : isDark,
                navColor != null ? navColor : color,
                navLightIcons != null ? navLightIcons : isDark,
                color
            );
            // A theme change while a screen draws behind the status bar must
            // not paint an opaque strip back over its cover.
            if (statusBarTransparent) applyOverlayStatusBar(activity, overlayLightIcons);
            if (navigationBarOverlay) applyOverlayNavigationBar(activity, overlayNavigationLightIcons);

            // No AppCompatDelegate.setDefaultNightMode() here. The UI is the
            // WebView, which already has the theme; switching the native night
            // mode at runtime only produced a configuration change whose
            // handler repainted the bars from the preferences as they were
            // BEFORE this call — the old theme — racing the page. The native
            // night mode is applied from the preferences above at the next
            // launch (MainActivity.onCreate), which is the only time native
            // resources (the splash) are drawn.

            call.resolve();
        });
    }

    /*
     * ── Drawing behind the status bar ──────────────────────────────────────
     *
     * Profile and community pages put their cover image under a transparent
     * status bar. Capacitor's SystemBars pads the decor view by the system-bar
     * insets (that padding is why every page starts below the clock), so this
     * plugin takes over that listener: identical padding on every edge, except
     * the top while an overlay is requested. The top inset is handed to the
     * page as `--status-bar-inset` so its header can clear the clock. Selected
     * entry/auth screens can also draw behind the transparent navigation bar;
     * its safe inset is exposed as `--navigation-bar-inset`.
     */

    private volatile boolean statusBarOverlay = false;
    private volatile boolean statusBarTransparent = false;
    private volatile boolean overlayLightIcons = true;
    private volatile boolean navigationBarOverlay = false;
    private volatile boolean overlayNavigationLightIcons = true;

    @Override
    public void load() {
        super.load();
        // Posted so it runs after every plugin's load(), including SystemBars,
        // whose own listener on the same view this replaces.
        final Activity activity = getActivity();
        if (activity != null) {
            activity.getWindow().getDecorView().post(this::installInsetsListener);
        }
    }

    /**
     * Capacitor's SystemBars registers its own listener on the same view, and
     * a view has one listener: whichever registered last wins. It registers at
     * load and may do so again later, so installing ours once was not enough —
     * when SystemBars' listener came back, the WebView was laid out under the
     * navigation buttons (the page's bottom content, and the app's own bottom
     * bar, hidden behind them) until something re-applied insets. Ours is
     * therefore (re)installed at every point where that could have happened.
     * Re-installing is idempotent: same listener logic, one re-dispatch.
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

            v.setPadding(
                bars.left,
                0,
                bars.right,
                keyboardVisible ? ime.bottom : (navigationBarOverlay ? 0 : bars.bottom)
            );

            final float density = activity.getResources().getDisplayMetrics().density;
            publishStatusBarInset(Math.round(bars.top / density));
            publishNavigationBarInset(navigationBarOverlay ? Math.round(bars.bottom / density) : 0);

            // Zeroed rather than CONSUMED, as Capacitor does, so the WebView keeps
            // recalculating its own safe-area values (chromium issue 461332423).
            return new WindowInsetsCompat.Builder(insets).setInsets(types, Insets.of(0, 0, 0, 0)).build();
        });
        ViewCompat.requestApplyInsets(decor);
    }

    private void publishStatusBarInset(int cssPx) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final String js = String.format(
            Locale.US,
            "document.documentElement.style.setProperty('--status-bar-inset','%dpx')",
            cssPx
        );
        getBridge().executeOnMainThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    private void publishNavigationBarInset(int cssPx) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final String js = String.format(
            Locale.US,
            "document.documentElement.style.setProperty('--navigation-bar-inset','%dpx')",
            cssPx
        );
        getBridge().executeOnMainThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    private static Integer parseOptionalColor(String value) {
        if (value == null || value.isEmpty()) return null;
        try {
            return Color.parseColor(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static void applyOverlayStatusBar(Activity activity, boolean lightIcons) {
        final Window window = activity.getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        final WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!lightIcons);
    }

    private static void applyOverlayNavigationBar(Activity activity, boolean lightIcons) {
        final Window window = activity.getWindow();
        window.setNavigationBarColor(Color.TRANSPARENT);
        final WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightNavigationBars(!lightIcons);
    }

    /**
     * @param call `enabled`: draw the page behind a transparent status bar
     *             `lightIcons`: status bar icons light (over a dark cover) or dark
     *             `contentUnderlay`: remove the top safe-area inset for pages drawing behind the bar
     *             `navigationEnabled`: draw the page behind the transparent navigation bar
     */
    @PluginMethod
    public void setStatusBarOverlay(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final boolean lightIcons = Boolean.TRUE.equals(call.getBoolean("lightIcons", true));
        // Older clients used `enabled` for both transparency and underlay.
        final boolean contentUnderlay = Boolean.TRUE.equals(call.getBoolean("contentUnderlay", enabled));
        final boolean navigationEnabled = Boolean.TRUE.equals(call.getBoolean("navigationEnabled", false));
        final boolean navigationLightIcons = Boolean.TRUE.equals(call.getBoolean("navigationLightIcons", true));
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }

        activity.runOnUiThread(() -> {
            installInsetsListener();
            final boolean wasTransparent = statusBarTransparent;
            final boolean changed = statusBarTransparent != enabled || statusBarOverlay != contentUnderlay;
            final boolean navigationChanged = navigationBarOverlay != navigationEnabled;
            statusBarTransparent = enabled;
            statusBarOverlay = contentUnderlay;
            overlayLightIcons = lightIcons;
            navigationBarOverlay = navigationEnabled;
            overlayNavigationLightIcons = navigationLightIcons;

            if (enabled) {
                applyOverlayStatusBar(activity, lightIcons);
            } else if (wasTransparent) {
                // Back to the app's opaque colours, as last set by setColors.
                final SharedPreferences prefs =
                    activity.getSharedPreferences(SystemUiHelper.PREFS, Activity.MODE_PRIVATE);
                final boolean dark = prefs.getBoolean(SystemUiHelper.KEY_LIGHT_ICONS, false);
                final int color = prefs.getInt(SystemUiHelper.KEY_BACKGROUND, dark ? Color.BLACK : Color.WHITE);
                SystemUiHelper.applySystemBars(activity, dark, color);
            }

            if (navigationEnabled) {
                applyOverlayNavigationBar(activity, navigationLightIcons);
            } else if (navigationChanged) {
                final SharedPreferences prefs =
                    activity.getSharedPreferences(SystemUiHelper.PREFS, Activity.MODE_PRIVATE);
                final boolean dark = prefs.getBoolean(SystemUiHelper.KEY_LIGHT_ICONS, false);
                final int color = prefs.getInt(SystemUiHelper.KEY_BACKGROUND, dark ? Color.BLACK : Color.WHITE);
                final WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                    activity.getWindow(), activity.getWindow().getDecorView()
                );
                controller.setAppearanceLightNavigationBars(!dark);
                activity.getWindow().setNavigationBarColor(color);
            }

            if (changed || navigationChanged) ViewCompat.requestApplyInsets(activity.getWindow().getDecorView());
            call.resolve();
        });
    }
}
