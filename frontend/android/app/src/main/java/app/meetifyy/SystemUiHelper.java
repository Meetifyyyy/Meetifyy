package app.meetifyy;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * Single source of truth for Meetifyy's native theme and system bars.
 *
 * Handles:
 * 1. Resolving the persisted theme preference before the splash screen and system bars show.
 * 2. Applying explicit Light (#FFFFFF) or Dark (#000000) status and navigation bars.
 * 3. Disabling Android 10+ (API 29+) contrast scrim enforcement on 3-button navigation.
 * 4. Handling Android 15+ (API 35+) edge-to-edge system bar appearance without tint regression.
 * 5. Managing activity-alias states so Android's cold-launch StartingWindow displays
 *    the user's chosen theme even before the app process forks.
 */
public final class SystemUiHelper {

    public static final String PREFS = "meetifyy.systemui";
    public static final String KEY_THEME = "theme";
    public static final String KEY_PREFERENCE_SET = "preferenceSet";
    public static final String KEY_BACKGROUND = "lastBackgroundColor";
    public static final String KEY_LIGHT_ICONS = "lightIcons";

    public static final int COLOR_LIGHT = Color.WHITE; // #FFFFFF
    public static final int COLOR_DARK = Color.BLACK;  // #000000

    private SystemUiHelper() {}

    public static final class ResolvedTheme {
        public final boolean isDark;
        public final String themeMode; // "light", "dark", or "system"
        public final boolean preferenceSet;

        public ResolvedTheme(boolean isDark, String themeMode, boolean preferenceSet) {
            this.isDark = isDark;
            this.themeMode = themeMode;
            this.preferenceSet = preferenceSet;
        }
    }

    /**
     * Resolves the theme to use on startup.
     *
     * Rule:
     * - If user has explicitly chosen "light" or "dark", that preference wins unconditionally.
     * - If user has chosen "system" or has never chosen (first launch), follow current device mode.
     */
    public static ResolvedTheme resolveTheme(Context context) {
        final SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        final boolean preferenceSet = prefs.getBoolean(KEY_PREFERENCE_SET, false);
        final String savedTheme = prefs.getString(KEY_THEME, "system");

        final int currentNightMode =
            context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        final boolean deviceIsDark = (currentNightMode == Configuration.UI_MODE_NIGHT_YES);

        if (preferenceSet) {
            if ("dark".equalsIgnoreCase(savedTheme)) {
                return new ResolvedTheme(true, "dark", true);
            }
            if ("light".equalsIgnoreCase(savedTheme)) {
                return new ResolvedTheme(false, "light", true);
            }
        }

        return new ResolvedTheme(deviceIsDark, "system", false);
    }

    /**
     * Pre-configures night mode and activity launch theme before installSplashScreen()
     * and super.onCreate().
     */
    public static void applyNightModeAndLaunchTheme(Activity activity, boolean isDark) {
        AppCompatDelegate.setDefaultNightMode(
            isDark ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO
        );
        activity.setTheme(
            isDark ? R.style.AppTheme_NoActionBarLaunch_Dark : R.style.AppTheme_NoActionBarLaunch_Light
        );
    }

    /**
     * Puts the window edge to edge and leaves it that way for the life of the
     * activity.
     *
     * WHY THE BARS ARE NEVER REPAINTED
     * Both system bars are transparent and the WebView is laid out beneath
     * them, so the only thing that paints those pixels is the page. It used to
     * be the other way round: the bars were painted natively with a colour the
     * page sampled from itself and sent across the bridge, so every navigation
     * moved two independent systems — the WebView and the window — that had to
     * be kept in step by an asynchronous call. They never were: the bar changed
     * a few frames after the page (measured on a device: 70 ms to 500 ms), which
     * is the flicker. On Android 15+ (targetSdk 35+) the platform forces bar
     * colours transparent anyway, so the painted-bar model could not have worked
     * there at all.
     *
     * What remains native is the window colour (shown only in the frames before
     * the WebView has drawn) and the bar ICON appearance, which the platform
     * gives no other way to set.
     *
     * @param isDark true for the dark theme (window #000000, light icons)
     * @param customColor optional window colour override (the page's chrome colour)
     */
    public static void applySystemBars(Activity activity, boolean isDark, Integer customColor) {
        if (activity == null || activity.isFinishing()) return;

        final Window window = activity.getWindow();
        if (window == null) return;
        final View decor = window.getDecorView();
        if (decor == null) return;

        final int windowColor = (customColor != null)
            ? customColor
            : (isDark ? COLOR_DARK : COLOR_LIGHT);

        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.clearFlags(
            WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS |
            WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION
        );

        // Contrast enforcement (API 29+) puts a grey scrim behind a 3-button
        // navigation bar. The page draws its own surface there.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        // Replacing a view's background can reset its padding, and the decor's
        // padding is where the keyboard inset lives. Carried across the swap so
        // the window never lays out without it for a frame.
        final int padLeft = decor.getPaddingLeft();
        final int padTop = decor.getPaddingTop();
        final int padRight = decor.getPaddingRight();
        final int padBottom = decor.getPaddingBottom();
        window.setBackgroundDrawable(new ColorDrawable(windowColor));
        decor.setBackgroundColor(windowColor);
        decor.setPadding(padLeft, padTop, padRight, padBottom);

        setBarIcons(activity, isDark, isDark);
    }

    /**
     * Paints the window and decor view, keeping the decor's padding (which is
     * where the keyboard inset lives — replacing a background can reset it).
     */
    public static void setWindowColor(Activity activity, int color) {
        if (activity == null || activity.isFinishing()) return;
        final Window window = activity.getWindow();
        if (window == null) return;
        final View decor = window.getDecorView();
        if (decor == null) return;
        final int l = decor.getPaddingLeft();
        final int t = decor.getPaddingTop();
        final int r = decor.getPaddingRight();
        final int b = decor.getPaddingBottom();
        window.setBackgroundDrawable(new ColorDrawable(color));
        decor.setBackgroundColor(color);
        decor.setPadding(l, t, r, b);
    }

    /**
     * Sets whether each bar's icons are drawn light (over a dark surface) or
     * dark. This is the one part of the bars the page cannot paint itself.
     */
    public static void setBarIcons(Activity activity, boolean statusLightIcons, boolean navLightIcons) {
        if (activity == null || activity.isFinishing()) return;
        final Window window = activity.getWindow();
        if (window == null) return;
        final View decor = window.getDecorView();
        if (decor == null) return;

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        if (controller == null) {
            controller = new WindowInsetsControllerCompat(window, decor);
        }
        // isAppearanceLight means "dark icons on a light background"
        controller.setAppearanceLightStatusBars(!statusLightIcons);
        controller.setAppearanceLightNavigationBars(!navLightIcons);
    }
}
