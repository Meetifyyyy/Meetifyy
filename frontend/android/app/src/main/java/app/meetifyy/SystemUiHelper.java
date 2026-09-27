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
     * Applies system status bar, navigation bar, decor view, and icon appearance.
     *
     * @param activity current Activity
     * @param isDark true for dark mode (#000000 with light icons), false for light mode (#FFFFFF with dark icons)
     * @param customColor optional custom background color override (e.g. from web computed style)
     */
    public static void applySystemBars(Activity activity, boolean isDark, Integer customColor) {
        final int barColor = (customColor != null)
            ? customColor
            : (isDark ? COLOR_DARK : COLOR_LIGHT);
        applySystemBars(activity, barColor, isDark, barColor, isDark, barColor);
    }

    /**
     * Paints each bar separately, so each can continue the page edge it meets.
     *
     * @param statusLightIcons true when the status bar's icons must be light
     * @param navLightIcons    true when the navigation bar's buttons must be light
     * @param windowColor      the window/decor colour: the theme's chrome, which is
     *                         what shows for a frame while the WebView lays out
     */
    private static int statusBarHeight(Activity activity) {
        final int id = activity.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? activity.getResources().getDimensionPixelSize(id) : 0;
    }

    public static void applySystemBars(
        Activity activity,
        int statusColor,
        boolean statusLightIcons,
        int navColor,
        boolean navLightIcons,
        int windowColor
    ) {
        if (activity == null || activity.isFinishing()) return;

        final Window window = activity.getWindow();
        if (window == null) return;
        final View decor = window.getDecorView();
        if (decor == null) return;

        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.clearFlags(
            WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS |
            WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION
        );

        // Disable contrast enforcement on Android 10+ (API 29+) to eliminate grey scrim on 3-button nav
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        // Apply bar colors for API < 35
        window.setStatusBarColor(statusColor);
        window.setNavigationBarColor(navColor);

        // Window background. Edge to edge, this is what the bars actually show
        // (see SystemBarsBackground), so it carries both bar colours. When the
        // two bars match it is the plain colour, as before.
        // Replacing a view's background resets its padding, and the decor's
        // padding is where the system-bar insets live. Carried across the swap
        // so the window never lays out without them — a frame without padding
        // shifted everything centred in the window, the splash icon included,
        // which is the up-and-down jump seen at launch.
        final int padLeft = decor.getPaddingLeft();
        final int padTop = decor.getPaddingTop();
        final int padRight = decor.getPaddingRight();
        final int padBottom = decor.getPaddingBottom();
        if (statusColor == navColor) {
            window.setBackgroundDrawable(new ColorDrawable(statusColor));
            decor.setBackgroundColor(statusColor);
        } else {
            final SystemBarsBackground bands =
                new SystemBarsBackground(statusColor, navColor, statusBarHeight(activity));
            window.setBackgroundDrawable(bands);
            decor.setBackground(new SystemBarsBackground(statusColor, navColor, statusBarHeight(activity)));
        }

        // Appearance controller for system bar icons and gesture pill
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        if (controller == null) {
            controller = new WindowInsetsControllerCompat(window, decor);
        }

        // isAppearanceLight means "dark icons on light background"
        controller.setAppearanceLightStatusBars(!statusLightIcons);
        controller.setAppearanceLightNavigationBars(!navLightIcons);

        decor.setPadding(padLeft, padTop, padRight, padBottom);
    }
}
