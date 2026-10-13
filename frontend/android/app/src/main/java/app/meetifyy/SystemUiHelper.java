package app.meetifyy;

import android.app.Activity;
import android.app.UiModeManager;
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
    public static final String KEY_SYSTEM_NIGHT_MODE = "systemNightMode";

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
    public static void applyNightModeAndLaunchTheme(Activity activity, ResolvedTheme theme) {
        final boolean isDark = theme.isDark;
        // "System" stays a live follow of the device, not a snapshot of it.
        AppCompatDelegate.setDefaultNightMode(
            !theme.preferenceSet
                ? AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
                : (isDark ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO)
        );
        syncSystemNightMode(activity, theme.preferenceSet ? (isDark ? "dark" : "light") : "system");
        activity.setTheme(
            isDark ? R.style.AppTheme_NoActionBarLaunch_Dark : R.style.AppTheme_NoActionBarLaunch_Light
        );
    }

    /**
     * Tells the SYSTEM which theme this app is in (Android 12+).
     *
     * The very first thing on screen at a cold start is the starting window
     * (the splash), and it is drawn by the system before any of this app's code
     * runs. Its colours come from resources (`launchBackground`, values vs
     * values-night) resolved in the night mode the system holds for the app,
     * which is the device's unless the app has told it otherwise. So a user who
     * chose Light on a dark phone saw a black splash, then this activity's
     * white one: the flicker. `setApplicationNightMode` is persisted by the
     * system, so the next cold start's splash is drawn in the user's theme from
     * its first frame. Set only when it differs: each call is a configuration
     * change for the running activity.
     *
     * Called at cold start (applyNightModeAndLaunchTheme) and when the app goes
     * to the background (MainActivity.onStop) — NOT when the user picks a
     * theme. A configuration change on the visible activity re-tints the bars'
     * icons and tells the WebView the colour scheme changed, in the middle of
     * the theme reveal; nothing on screen needs it, only the next cold start's
     * splash does, and that is always preceded by onStop.
     *
     * @param themeMode "light", "dark" or "system"
     */
    public static void syncSystemNightMode(Context context, String themeMode) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || context == null) return;
        final UiModeManager uiMode = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        if (uiMode == null) return;
        final int wanted = "dark".equalsIgnoreCase(themeMode)
            ? UiModeManager.MODE_NIGHT_YES
            : "light".equalsIgnoreCase(themeMode) ? UiModeManager.MODE_NIGHT_NO : UiModeManager.MODE_NIGHT_AUTO;
        // The value last handed to the system, so an unchanged choice is not a
        // configuration change (there is no public getter for it).
        final SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getInt(KEY_SYSTEM_NIGHT_MODE, -1) == wanted) return;
        try {
            uiMode.setApplicationNightMode(wanted);
            prefs.edit().putInt(KEY_SYSTEM_NIGHT_MODE, wanted).apply();
        } catch (RuntimeException ignored) {
            // A vendor build that refuses it keeps the previous behaviour.
        }
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
        // padding holds the side insets (landscape cutout / side navigation).
        // Carried across the swap so the window never lays out without it.
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
     * Paints the window and decor view, keeping the decor's padding (the side
     * insets; replacing a background can reset it).
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

    /*
     * ── Bar icons: the page's choice, and the reveal's hold on it ──────────
     *
     * The page decides the icons (SystemUiPlugin.setIcons), because only the
     * page knows what is drawn under each bar. Normally its choice is applied
     * at once. During a native theme reveal (ThemeRevealPlugin) it is not: the
     * page has already switched to the NEW theme underneath a screenshot of the
     * OLD one, and asks for the new theme's icons straight away — but on screen
     * each bar still shows the old theme until the growing circle reaches it.
     * Applying the request immediately put white icons over a still-white
     * status bar for most of the 800 ms.
     *
     * So while a reveal holds the icons, a request is only REMEMBERED (it is
     * the reveal's "target"), and the reveal applies old or target per bar as
     * the circle crosses it. When the hold is released, the latest request is
     * applied. One place records the page's choice and one decides what is
     * applied, so a request that arrives mid-reveal is never lost and never
     * shown early.
     */

    /** Implemented by the reveal while it decides the icons. UI thread only. */
    public interface IconHold {
        /**
         * The page asked for new icons (now in {@link #pageStatusLightIcons()}
         * / {@link #pageNavLightIcons()}), or the system reset them.
         *
         * @param force true when the system may have re-tinted the icons behind
         *              our back (a configuration change), so whatever the hold
         *              last applied must be applied again even if unchanged
         */
        void onPageIconsChanged(boolean force);
    }

    /** The icons the page last asked for (SystemUiPlugin.setIcons); null until it has. UI thread only. */
    private static Boolean pageStatusLightIcons = null;
    private static Boolean pageNavLightIcons = null;
    /** Non-null while a reveal decides the icons. UI thread only. */
    private static IconHold iconHold = null;

    public static void rememberPageIcons(boolean statusLightIcons, boolean navLightIcons) {
        pageStatusLightIcons = statusLightIcons;
        pageNavLightIcons = navLightIcons;
    }

    /** The page's latest status-bar request, or null if it has never sent one. */
    public static Boolean pageStatusLightIcons() {
        return pageStatusLightIcons;
    }

    /** The page's latest navigation-bar request, or null if it has never sent one. */
    public static Boolean pageNavLightIcons() {
        return pageNavLightIcons;
    }

    /**
     * The page's request (SystemUiPlugin.setIcons): remembered always, applied
     * unless a reveal holds the icons, in which case the reveal is told and
     * applies it when the circle reaches each bar.
     */
    public static void setPageIcons(Activity activity, boolean statusLightIcons, boolean navLightIcons) {
        rememberPageIcons(statusLightIcons, navLightIcons);
        if (iconHold != null) {
            iconHold.onPageIconsChanged(false);
            return;
        }
        setBarIcons(activity, statusLightIcons, navLightIcons);
    }

    /** A reveal takes over the icons. A second hold replaces the first (there is one reveal). */
    public static void holdIcons(IconHold hold) {
        iconHold = hold;
    }

    /**
     * Ends the hold and applies the page's latest request, so the bars settle
     * on what is actually under them now that the overlay is gone. A no-op if
     * {@code hold} no longer holds (a stale release must not end a newer one).
     */
    public static void releaseIcons(Activity activity, IconHold hold) {
        if (iconHold != hold) return;
        iconHold = null;
        reapplyPageIcons(activity);
        if (!afterReveal.isEmpty()) {
            final java.util.ArrayList<Runnable> pending = new java.util.ArrayList<>(afterReveal.values());
            afterReveal.clear();
            for (Runnable r : pending) r.run();
        }
    }

    /**
     * Window work deferred while a reveal is on screen, latest per key.
     *
     * Changing the window's background relayouts the window (relayoutWindow,
     * and a frame of UI-thread work), and the page asks for it in the middle of
     * the reveal, when it samples the new theme's colours. Measured on the
     * I2208 that cost three frames of the circle. Nothing behind the overlay
     * and the WebView can show the window colour anyway, so it is applied once
     * the reveal has ended. UI thread only.
     */
    private static final java.util.LinkedHashMap<String, Runnable> afterReveal = new java.util.LinkedHashMap<>();

    /** Runs {@code work} now, or - while a reveal holds the bars - once it ends. */
    public static void runWhenRevealEnds(String key, Runnable work) {
        if (iconHold == null) {
            work.run();
            return;
        }
        afterReveal.remove(key);
        afterReveal.put(key, work);
    }

    public static boolean iconsHeld() {
        return iconHold != null;
    }

    /**
     * Puts the page's icon choice back after the system has reset it.
     *
     * A night-mode change (the app's own, syncSystemNightMode, or the device's)
     * is a configuration change, and the system answers it by re-tinting the
     * bars' icons to the new theme's default. That is not always what is under
     * them - and measured on a device it left white icons over a white bar
     * after a switch to Light until the next change came along.
     *
     * During a reveal the page's choice is not what should be on screen (see
     * above), so the reveal re-applies its own per-bar decision instead.
     */
    public static void reapplyPageIcons(Activity activity) {
        if (iconHold != null) {
            iconHold.onPageIconsChanged(true);
            return;
        }
        if (pageStatusLightIcons == null || pageNavLightIcons == null) return;
        setBarIcons(activity, pageStatusLightIcons, pageNavLightIcons);
    }

    /**
     * Whether the status bar's icons are light right now, read back from the
     * window rather than from what the page last asked for: the reveal needs
     * what is ON SCREEN (the "old" icons), and something other than the page
     * (applySystemBars at launch, a configuration change) may have set it.
     */
    public static boolean statusLightIconsApplied(Activity activity) {
        final WindowInsetsControllerCompat controller = controllerFor(activity);
        return controller != null && !controller.isAppearanceLightStatusBars();
    }

    /** As {@link #statusLightIconsApplied}, for the navigation bar. */
    public static boolean navLightIconsApplied(Activity activity) {
        final WindowInsetsControllerCompat controller = controllerFor(activity);
        return controller != null && !controller.isAppearanceLightNavigationBars();
    }

    private static WindowInsetsControllerCompat controllerFor(Activity activity) {
        if (activity == null) return null;
        final Window window = activity.getWindow();
        if (window == null) return null;
        final View decor = window.getDecorView();
        if (decor == null) return null;
        return WindowCompat.getInsetsController(window, decor);
    }

    /**
     * Sets whether each bar's icons are drawn light (over a dark surface) or
     * dark. This is the one part of the bars the page cannot paint itself.
     * Applies unconditionally: callers that must respect a reveal's hold go
     * through {@link #setPageIcons} / {@link #reapplyPageIcons}.
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
