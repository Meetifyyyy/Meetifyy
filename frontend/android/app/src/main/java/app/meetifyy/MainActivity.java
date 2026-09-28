package app.meetifyy;

import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.splashscreen.SplashScreenViewProvider;

import com.getcapacitor.BridgeActivity;

/**
 * Main Android entry point for Meetifyy.
 *
 * Responsibilities:
 * 1. Resolves persisted theme preference (light, dark, or system fallback) before
 *    SplashScreen.installSplashScreen() and super.onCreate().
 * 2. Applies explicit launch themes and system bar colors immediately upon startup.
 * 3. Holds the system splash screen until AuthContext and React confirm the app is ready.
 * 4. Ensures no dark splash -> light app or light splash -> dark app flashes.
 */
public class MainActivity extends BridgeActivity {

    private static final long SPLASH_TIMEOUT_MS = 5000;
    private static final long POLL_INTERVAL_MS = 32;
    /** The splash fades over the already-painted page: a crossfade, not a cut. */
    private static final long SPLASH_FADE_MS = 280L;

    private boolean contentPainted = false;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 1. Resolve persisted theme preference BEFORE splash screen is initialized
        final SystemUiHelper.ResolvedTheme resolvedTheme = SystemUiHelper.resolveTheme(this);
        SystemUiHelper.applyNightModeAndLaunchTheme(this, resolvedTheme.isDark);

        // 2. Install splash screen using the resolved theme
        final SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // 3. Register custom SystemUi plugin before super.onCreate
        registerPlugin(SystemUiPlugin.class);

        super.onCreate(savedInstanceState);

        // 4. Apply system bars and decor background immediately
        SystemUiHelper.applySystemBars(this, resolvedTheme.isDark, null);
        applyTransparentLaunchNavigationBar();
        applyLaunchBackground(resolvedTheme.isDark);

        // 5. Remove the WebView's own scrollbars.
        hideWebViewScrollbars();

        final int splashColor = resolvedTheme.isDark ? SystemUiHelper.COLOR_DARK : SystemUiHelper.COLOR_LIGHT;
        if (getWindow() != null && getWindow().getDecorView() != null) {
            findAndColorSplashView(getWindow().getDecorView(), splashColor);
            getWindow().getDecorView().post(() ->
                findAndColorSplashView(getWindow().getDecorView(), splashColor));
        }

        /*
         * The SYSTEM splash stays on screen until the page is ready and has
         * painted (see launchReadiness.js), with a static logo.
         *
         * Handing it over to a view in this window early — which is what any
         * logo animation would need, since Android 12+ draws a held splash in
         * its own window — moved the logo ~15px as the window's insets settled.
         * Holding the system window leaves nothing to line up.
         */
        splashScreen.setKeepOnScreenCondition(() -> !contentPainted);
        splashScreen.setOnExitAnimationListener(provider -> {
            if (provider == null) return;
            fadeSplashOut(provider);
        });

        final long deadline = SystemClock.uptimeMillis() + SPLASH_TIMEOUT_MS;
        handler.post(new Runnable() {
            private boolean themeSynced = false;

            @Override
            public void run() {
                if (contentPainted) return;

                final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (SystemClock.uptimeMillis() >= deadline) {
                    // Backstop. The page is on screen from here and owns the bars.
                    finishLaunch(webView);
                    return;
                }
                if (webView == null) {
                    handler.postDelayed(this, POLL_INTERVAL_MS);
                    return;
                }
                // The first call ran moments after super.onCreate, when the bridge
                // may not have existed yet; setting these twice costs nothing.
                hideWebViewScrollbars();

                if (!themeSynced && resolvedTheme.preferenceSet) {
                    themeSynced = true;
                    final String themeStr = resolvedTheme.isDark ? "dark" : "light";
                    webView.evaluateJavascript(
                        "(function(){try{"
                            + "if(localStorage.getItem('theme_preference_set')!=='true'){"
                            + "localStorage.setItem('theme_preference_set','true');"
                            + "localStorage.setItem('theme','" + themeStr + "');"
                            + "document.documentElement.setAttribute('data-theme','" + themeStr + "');"
                            + "}"
                            + "}catch(e){}})()",
                        null
                    );
                }

                final Runnable self = this;
                // Readiness AND the theme the page booted in. The page's choice
                // (localStorage, read before its first paint) is the source of
                // truth; if the preferences the window was painted from lag it,
                // the window behind the WebView is repainted to match before the
                // splash lifts, so the first frame shown is never the wrong theme.
                webView.evaluateJavascript(
                    "(function(){try{return (window.__meetifyyBoot && window.__meetifyyBoot.appReady ? 'ready:' : 'wait:')"
                        + "+(document.documentElement.getAttribute('data-theme')||'')}"
                        + "catch(e){return 'wait:'}})()",
                    raw -> {
                        final String value = raw == null ? "" : raw.replace("\"", "");
                        final boolean pageDark = value.endsWith(":dark");
                        final boolean pageLight = value.endsWith(":light");
                        if ((pageDark || pageLight) && pageDark != resolvedTheme.isDark) {
                            SystemUiHelper.applySystemBars(MainActivity.this, pageDark, null);
                            applyLaunchBackground(pageDark);
                        }
                        if (value.startsWith("ready")) {
                            finishLaunch(webView);
                        } else {
                            handler.postDelayed(self, POLL_INTERVAL_MS);
                        }
                    }
                );
            }
        });
    }

    /** Lifts the splash; from here the page owns the system bars. */
    private void finishLaunch(WebView webView) {
        if (contentPainted) return;
        contentPainted = true;
        if (webView != null) requestPageBars(webView);
    }

    /**
     * Asks the page to repaint the system bars now that the splash is gone.
     *
     * The splash paints the bars in the theme colour while it covers the page,
     * and it can do so AFTER the page has already sent its own colours (each
     * bar continuing the page edge beneath it). The page does not re-send an
     * unchanged payload, so without this the bars stayed in the splash colour
     * — plain white over a blue page — until something else changed.
     */
    private void requestPageBars(WebView webView) {
        webView.evaluateJavascript(
            "(function(){try{window.dispatchEvent(new Event('meetifyy:system-bars-reset'))}catch(e){}})()",
            null
        );
    }

    /** Tells the page the splash has started to leave (its fade has begun). */
    private void notifySplashExiting() {
        evaluateOnPage(
            "(function(){try{window.__meetifyySplashExiting=true;"
                + "window.dispatchEvent(new Event('meetifyy:splash-exiting'))}catch(e){}})()"
        );
    }

    /** Tells the page the splash is gone. */
    private void notifySplashExited() {
        evaluateOnPage(
            "(function(){try{window.__meetifyySplashExited=true;try{window.sessionStorage.setItem('__meetifyySplashExited','true')}catch(e){};window.dispatchEvent(new Event('meetifyy:splash-exited'))}catch(e){}})()"
        );
    }

    private void evaluateOnPage(String script) {
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        webView.evaluateJavascript(script, null);
    }

    /** The splash logo view, in the splash view the exit listener is handed. */
    private View findSplashIcon(View root) {
        final int iconId = getResources().getIdentifier(
            "splashscreen_icon_view", "id", getPackageName()
        );
        return iconId == 0 || root == null ? null : root.findViewById(iconId);
    }

    /**
     * Crossfades the splash into the page, which is already painted beneath it.
     * The page is told as the fade starts, so its own entrance plays under it.
     *
     * The logo is pinned for the duration: the page repaints the system bars
     * as the splash lifts, and a change in their insets re-lays out the splash
     * view, which could move the centred logo upward in the last frames. Any
     * such shift is cancelled with an equal and opposite translation.
     */
    private void fadeSplashOut(SplashScreenViewProvider provider) {
        final View splashView = provider.getView();
        notifySplashExiting();
        if (splashView == null) {
            provider.remove();
            notifySplashExited();
            return;
        }
        View icon = provider.getIconView();
        if (icon == null) icon = findSplashIcon(splashView);
        if (icon != null) {
            final int[] start = new int[2];
            icon.getLocationOnScreen(start);
            final int startY = start[1] - Math.round(icon.getTranslationY());
            icon.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
                final int[] now = new int[2];
                v.getLocationOnScreen(now);
                v.setTranslationY(startY - (now[1] - Math.round(v.getTranslationY())));
            });
        }
        splashView.animate()
            .alpha(0f)
            .setDuration(SPLASH_FADE_MS)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(() -> {
                provider.remove();
                notifySplashExited();
            })
            .start();
    }

    /**
     * Turns off the WebView's NATIVE scrollbars.
     *
     * WHY CSS CANNOT DO THIS
     * `scrollbar-width: none` and `::-webkit-scrollbar { display: none }` — both
     * of which the app already sets in `src/mobile/mobile.css` — control the
     * scrollbars the RENDERER draws for a CSS scroll container. The bar that
     * remained is a different thing: Android's `View` class draws its own
     * scrollbars for the WebView itself, outside the page entirely, and no
     * amount of page CSS reaches it. It is a View property, so it has to be
     * turned off on the View.
     *
     * Both axes, and `SCROLLBARS_OUTSIDE_OVERLAY` as a belt-and-braces: with
     * the flags off there is nothing to draw, and the style keeps any bar that
     * some OEM WebView decides to draw anyway from insetting the content.
     *
     * Scrolling itself is untouched — this hides the indicator, exactly as the
     * CSS half does, and the page scrolls as before.
     */
    private void hideWebViewScrollbars() {
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;

        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setScrollBarStyle(WebView.SCROLLBARS_OUTSIDE_OVERLAY);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

    }

    /**
     * Paints the activity window, decor view, and WebView with the resolved theme color.
     */
    private void applyLaunchBackground(boolean isDark) {
        final int color = isDark ? SystemUiHelper.COLOR_DARK : SystemUiHelper.COLOR_LIGHT;

        if (getWindow() != null) {
            getWindow().setBackgroundDrawable(new ColorDrawable(color));
            if (getWindow().getDecorView() != null) {
                getWindow().getDecorView().setBackgroundColor(color);
            }
        }

        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(color);
        }
    }

    /** Keep the native navigation strip clear while the native splash is shown. */
    private void applyTransparentLaunchNavigationBar() {
        if (getWindow() == null) return;
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
    }

    /**
     * Recursively traverses views to find and color the platform SplashScreenView.
     */
    private void findAndColorSplashView(android.view.View view, int color) {
        if (view == null) return;
        final String name = view.getClass().getName();
        if (name.contains("SplashScreen") || name.contains("SplashScreenView")) {
            view.setBackgroundColor(color);
        }
        if (view instanceof android.view.ViewGroup) {
            final android.view.ViewGroup group = (android.view.ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                findAndColorSplashView(group.getChildAt(i), color);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Once the page is up it owns the bars (each continues the page edge
        // it meets) and re-sends them itself on becoming visible. Repainting
        // from preferences here flashed the theme colour over the page's.
        if (contentPainted) return;
        final SystemUiHelper.ResolvedTheme currentTheme = SystemUiHelper.resolveTheme(this);
        SystemUiHelper.applySystemBars(this, currentTheme.isDark, null);
        applyTransparentLaunchNavigationBar();
        applyLaunchBackground(currentTheme.isDark);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Same as onResume: rotation and device theme changes reach the page
        // (resize, prefers-color-scheme), which repaints the bars itself.
        if (contentPainted) return;
        final SystemUiHelper.ResolvedTheme currentTheme = SystemUiHelper.resolveTheme(this);

        // If the user explicitly chose Light or Dark, device changes must NOT override the app
        if (currentTheme.preferenceSet) {
            SystemUiHelper.applySystemBars(this, currentTheme.isDark, null);
            applyTransparentLaunchNavigationBar();
            applyLaunchBackground(currentTheme.isDark);
        } else {
            // System mode: follow device configuration change
            final boolean deviceIsDark =
                (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            SystemUiHelper.applySystemBars(this, deviceIsDark, null);
            applyTransparentLaunchNavigationBar();
            applyLaunchBackground(deviceIsDark);
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
