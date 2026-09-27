package app.meetifyy;

import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.animation.ObjectAnimator;
import android.animation.Keyframe;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;

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

    private boolean contentPainted = false;
    private ObjectAnimator splashLogoAnimator;
    private int splashIconLookupAttempts;
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
            getWindow().getDecorView().post(() -> {
                findAndColorSplashView(getWindow().getDecorView(), splashColor);
                startSplashLogoHeartbeat(getWindow().getDecorView());
            });
        }

        /*
         * The SYSTEM splash stays on screen until the page is ready, and is then
         * removed in one step.
         *
         * It used to exit on the first frame into a hand-off view held by the
         * exit-animation listener. That view lives in the activity's window,
         * which is padded by the system-bar insets (more at the bottom than the
         * top), so its centre sat higher than the full-screen system splash:
         * measured on a device, the logo vanished for two frames and came back
         * ~15px higher, then wobbled while insets settled. Keeping the system
         * window up leaves nothing to line up.
         */
        splashScreen.setKeepOnScreenCondition(() -> !contentPainted);
        // Fade out the native logo only after the page reports appReady. The
        // opening screen starts its own subtle entrance when this fade ends.
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

    /** Starts the opening screen entrance after the native splash is gone. */
    private void notifySplashExited() {
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        webView.evaluateJavascript(
            "(function(){try{window.__meetifyySplashExited=true;try{window.sessionStorage.setItem('__meetifyySplashExited','true')}catch(e){};window.dispatchEvent(new Event('meetifyy:splash-exited'))}catch(e){}})()",
            null
        );
    }

    /** Starts a centered, compositor-driven heartbeat as soon as splash views exist. */
    private void startSplashLogoHeartbeat(View decor) {
        final int iconId = getResources().getIdentifier(
            "splashscreen_icon_view", "id", getPackageName()
        );
        final View icon = iconId == 0 ? null : decor.findViewById(iconId);
        if (icon == null) {
            if (++splashIconLookupAttempts < 12 && !contentPainted) {
                decor.postDelayed(() -> startSplashLogoHeartbeat(decor), POLL_INTERVAL_MS);
            }
            return;
        }

        // Scale around the image's own center; endpoints match exactly so there
        // is no position jump when the native splash begins to fade away.
        icon.setPivotX(icon.getWidth() / 2f);
        icon.setPivotY(icon.getHeight() / 2f);
        final PropertyValuesHolder x = PropertyValuesHolder.ofKeyframe(View.SCALE_X,
            Keyframe.ofFloat(0f, 1f), Keyframe.ofFloat(0.12f, 1.035f),
            Keyframe.ofFloat(0.24f, 1f), Keyframe.ofFloat(0.34f, 1.022f),
            Keyframe.ofFloat(0.46f, 1f), Keyframe.ofFloat(1f, 1f));
        final PropertyValuesHolder y = PropertyValuesHolder.ofKeyframe(View.SCALE_Y,
            Keyframe.ofFloat(0f, 1f), Keyframe.ofFloat(0.12f, 1.035f),
            Keyframe.ofFloat(0.24f, 1f), Keyframe.ofFloat(0.34f, 1.022f),
            Keyframe.ofFloat(0.46f, 1f), Keyframe.ofFloat(1f, 1f));
        splashLogoAnimator = ObjectAnimator.ofPropertyValuesHolder(icon, x, y);
        splashLogoAnimator.setDuration(1500L);
        splashLogoAnimator.setRepeatCount(ValueAnimator.INFINITE);
        splashLogoAnimator.setInterpolator(new LinearInterpolator());
        splashLogoAnimator.start();
    }

    private void fadeSplashOut(SplashScreenViewProvider provider) {
        final View splashView = provider.getView();
        if (splashView == null) {
            stopSplashLogoHeartbeat();
            provider.remove();
            notifySplashExited();
            return;
        }
        splashView.animate()
            .alpha(0f)
            .setDuration(180L)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(() -> {
                stopSplashLogoHeartbeat();
                provider.remove();
                notifySplashExited();
            })
            .start();
    }

    private void stopSplashLogoHeartbeat() {
        if (splashLogoAnimator == null) return;
        splashLogoAnimator.cancel();
        splashLogoAnimator = null;
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
        stopSplashLogoHeartbeat();
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
