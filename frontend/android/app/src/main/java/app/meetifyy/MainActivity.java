package app.meetifyy;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.view.Choreographer;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.splashscreen.SplashScreenViewProvider;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.ArrayDeque;

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
    /*
     * The exit, once the page is on screen beneath the splash (see
     * exitSplashOncePainted): the logo shrinks a little and fades, and the
     * background follows a few frames behind it, so the page is revealed by a
     * crossfade with the logo already almost gone. Short: the page under the
     * splash is fully painted, so this is a reveal, not a wait.
     */
    private static final long SPLASH_ICON_EXIT_MS = 100L;
    private static final float SPLASH_ICON_EXIT_SCALE = 0.92f;
    private static final long SPLASH_BACKGROUND_DELAY_MS = 55L;
    private static final long SPLASH_BACKGROUND_EXIT_MS = 170L;
    /** Longest wait for the WebView to report it has drawn the page (see exitSplashOncePainted). */
    private static final long SPLASH_PAINT_WAIT_MS = 250L;

    private boolean contentPainted = false;
    private boolean fullyDrawnReported = false;
    /** The splash has begun to uncover the page (fadeSplashOut). */
    private boolean splashRevealing = false;
    /** The page reported its content before the reveal began: what it found, reported at the reveal. */
    private String pendingFullyDrawn = null;
    /** The splash, handed over to this window and held until the page is ready (see onCreate). */
    private SplashScreenViewProvider heldSplash = null;
    /**
     * The splash whose exit has started (exitSplashOncePainted). Per splash, not
     * once per activity: the system shows one again on a warm return (see the
     * exit listener in onCreate), and each must be taken off the page.
     */
    private SplashScreenViewProvider exitingSplash = null;
    private long visualStateRequestId = 0;
    private final Handler handler = new Handler(Looper.getMainLooper());

    /*
     * Recovering from a lost WebView renderer (see onRendererLost). Static: the
     * recovery recreates this activity, and the new instance reads them.
     */
    private static final String WEBVIEW_TAG = "MeetifyyWebView";
    /** A renderer lost this many times within RENDERER_LOSS_WINDOW_MS is not recovered again. */
    private static final int MAX_RENDERER_RECOVERIES = 2;
    private static final long RENDERER_LOSS_WINDOW_MS = 60_000L;
    /** How long the recreated activity has to pick up the recovery (see load). */
    private static final long RECOVERY_TTL_MS = 10_000L;
    private static final ArrayDeque<Long> rendererLosses = new ArrayDeque<>();
    /** When the renderer was last lost and the activity recreated for it; 0 once picked up. */
    private static long recoveryStartedAt = 0;
    /** The page to reopen in the recreated activity, or null for the start page. */
    private static String restoreUrl = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 1. Resolve persisted theme preference BEFORE splash screen is initialized
        final SystemUiHelper.ResolvedTheme resolvedTheme = SystemUiHelper.resolveTheme(this);
        SystemUiHelper.applyNightModeAndLaunchTheme(this, resolvedTheme);

        // 2. Install splash screen using the resolved theme
        final SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // 3. Register the app's own plugins before super.onCreate
        registerPlugin(SystemUiPlugin.class);
        registerPlugin(InstagramStoriesPlugin.class);
        registerPlugin(ThemeRevealPlugin.class);
        registerPlugin(PageTransitionPlugin.class);
        registerPlugin(PushSupportPlugin.class);
        registerPlugin(MediaFullscreenPlugin.class);

        super.onCreate(savedInstanceState);

        // 3b. Survive the WebView's renderer being lost (see onRendererLost).
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    return onRendererLost(view, detail);
                }
            });
        }

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
         * The splash is handed over to this window as soon as the activity has
         * drawn, and kept there, unchanged, until the page is ready and has
         * painted (see launchReadiness.js and finishLaunch).
         *
         * It used to be the other way round: the SYSTEM splash window was held
         * (setKeepOnScreenCondition) until the page was ready, and only then
         * handed over. But the hand-over itself is slow — traced on the I2208
         * (2026-10-26), after the activity's first frame the system ran its own
         * `starting_reveal` step for ~270 ms before the app received the splash
         * view, and the logs showed 340-490 ms from "page ready" to the reveal
         * starting. All of that was spent after the page was ready, behind a
         * splash. Handed over at the activity's first frame instead, the same
         * wait overlaps the page's own boot.
         *
         * The handed-over splash is a view in this window, on top of everything
         * (the page beneath may be blank until it paints; nothing of it shows).
         * A change in the window's insets would re-lay it out and could move
         * the centred logo — the ~15 px shift that once kept the splash in the
         * system window — so its logo is pinned from the moment it arrives
         * (pinSplashIcon).
         */
        splashScreen.setOnExitAnimationListener(provider -> {
            if (provider == null) {
                // Nothing to hold or animate: the page is uncovered as it is.
                splashRevealing = true;
                if (pendingFullyDrawn != null) {
                    final String what = pendingFullyDrawn;
                    pendingFullyDrawn = null;
                    onPageFullyDrawn(what);
                }
                return;
            }
            /*
             * Not only at launch. On Android 12+ the system shows the splash
             * again on a WARM return when it has no snapshot of the app to show
             * (seen on the I2208 coming back from Chrome through Recents), and
             * hands that one over here too. It was held forever, because the
             * exit ran once per activity: a black (or white) screen over the
             * live page that swallowed every tap. The page is already painted
             * then, so it is revealed as soon as the WebView has drawn.
             */
            heldSplash = provider;
            pinSplashIcon(provider);
            if (isDebuggable()) Log.i("MeetifyyLaunch", "splash handed over at +" + sinceProcessStart() + "ms");
            if (contentPainted) exitSplashOncePainted(provider);
            // Otherwise finishLaunch starts the exit once the page is ready.
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
                    finishLaunch(webView, "backstop");
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
                            finishLaunch(webView, "poll");
                        } else {
                            handler.postDelayed(self, POLL_INTERVAL_MS);
                        }
                    }
                );
            }
        });
    }

    /**
     * Readiness pushed from the page (SystemUiPlugin.appReady), instead of
     * waiting for the next poll to get through the page's busy main thread.
     * Applies the same theme correction the poll does before lifting.
     */
    void onPageReady(String theme) {
        if (contentPainted) return;
        final boolean pageDark = "dark".equals(theme);
        final boolean pageLight = "light".equals(theme);
        if (pageDark || pageLight) {
            final boolean launchDark = SystemUiHelper.resolveTheme(this).isDark;
            if (pageDark != launchDark) {
                SystemUiHelper.applySystemBars(this, pageDark, null);
                applyLaunchBackground(pageDark);
            }
        }
        finishLaunch(getBridge() != null ? getBridge().getWebView() : null, "push");
    }

    /**
     * The page is ready and painted: the splash may go (once it has been handed
     * to this window; see onCreate). From here the page owns the system bars.
     */
    private void finishLaunch(WebView webView, String via) {
        if (contentPainted) return;
        contentPainted = true;
        // Debug builds only: when, and by which path, the page reported ready.
        if (isDebuggable()) Log.i("MeetifyyLaunch", "page ready via " + via + " at +" + sinceProcessStart() + "ms");
        if (webView != null) requestPageBars(webView);
        if (heldSplash != null) exitSplashOncePainted(heldSplash);
    }

    /**
     * The first screen has its content, not a placeholder (SystemUiPlugin.fullyDrawn,
     * from launchReadiness.js): Home's first posts or its empty state, or the
     * signed-out opening screen.
     *
     * Reported to the system with reportFullyDrawn(), which is what Android
     * calls time to full display (TTFD): `Fully drawn` in the log, the metric
     * Android vitals and Macrobenchmark read. The splash lifting is time to
     * initial display, which on a launch with no saved feed can be a skeleton.
     * Once per activity, and only once the content is VISIBLE: when the page
     * has it before the splash has begun to uncover the page (a saved feed),
     * the report waits for the reveal, so the time is when the user can see
     * it, not when it existed behind the splash.
     */
    void onPageFullyDrawn(String what) {
        if (fullyDrawnReported || !contentPainted || isFinishing()) return;
        if (!splashRevealing) {
            pendingFullyDrawn = what == null ? "" : what;
            return;
        }
        fullyDrawnReported = true;
        if (isDebuggable()) Log.i("MeetifyyLaunch", "fully drawn (" + what + ") at +" + sinceProcessStart() + "ms");
        try {
            reportFullyDrawn();
        } catch (SecurityException e) {
            // Some OEM builds guard this behind a permission on older releases; the app is unaffected.
        }
    }

    private boolean isDebuggable() {
        return (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** Milliseconds since this process was forked: a cold start's own clock, for the debug log. */
    private static long sinceProcessStart() {
        return SystemClock.uptimeMillis() - Process.getStartUptimeMillis();
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

    /**
     * Keeps the handed-over splash's logo exactly where the system drew it.
     *
     * The splash view is laid out by this window, and the window's insets
     * settle while the page boots (the bars go transparent, the page publishes
     * its own). Each change re-lays out the splash view and could move the
     * centred logo; this cancels any such shift with an equal and opposite
     * translation, measured on screen, so the logo never moves between the
     * system's window and this one, or while it is held.
     */
    private void pinSplashIcon(SplashScreenViewProvider provider) {
        final View splashView = provider.getView();
        View icon = provider.getIconView();
        if (icon == null) icon = findSplashIcon(splashView);
        if (icon == null) return;
        final int[] start = new int[2];
        icon.getLocationOnScreen(start);
        final int startY = start[1] - Math.round(icon.getTranslationY());
        icon.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            final int[] now = new int[2];
            v.getLocationOnScreen(now);
            v.setTranslationY(startY - (now[1] - Math.round(v.getTranslationY())));
        });
    }

    /** The splash logo view, in the splash view the exit listener is handed. */
    private View findSplashIcon(View root) {
        final int iconId = getResources().getIdentifier(
            "splashscreen_icon_view", "id", getPackageName()
        );
        return iconId == 0 || root == null ? null : root.findViewById(iconId);
    }

    /**
     * Starts the exit only once the page is actually on screen beneath it.
     * Called when the page is ready and the splash is in this window, in
     * whichever order those happen (onCreate's listener, finishLaunch).
     *
     * "Ready" means the page has painted in Chromium; the window may not have
     * drawn that yet, so the WebView beneath can still be empty. Recorded on
     * the I2208 (2026-10-26) the old exit, which hid the logo
     * at once and faded the background, showed the logo, then two to three
     * frames of plain splash colour with no logo, then the feed all at once —
     * the blink seen as the splash "flickering". `postVisualStateCallback`
     * fires when the WebView's next draw shows the page as it is now; the exit
     * starts on the frame after that, so whatever the splash uncovers is the
     * page. A WebView that never reports (detached, not drawing) is not waited
     * on for long.
     */
    private void exitSplashOncePainted(SplashScreenViewProvider provider) {
        if (exitingSplash == provider) return;
        exitingSplash = provider;
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            fadeSplashOut(provider);
            return;
        }
        final boolean[] started = { false };
        final Runnable start = () -> {
            if (started[0]) return;
            started[0] = true;
            Choreographer.getInstance().postFrameCallback(frameTimeNanos -> fadeSplashOut(provider));
        };
        final Runnable fallback = () -> {
            if (isDebuggable() && !started[0]) Log.i("MeetifyyLaunch", "page paint not reported; revealing anyway");
            start.run();
        };
        handler.postDelayed(fallback, SPLASH_PAINT_WAIT_MS);
        final long requestId = ++visualStateRequestId;
        webView.postVisualStateCallback(requestId, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long id) {
                if (id != requestId) return;
                handler.removeCallbacks(fallback);
                if (isDebuggable() && !started[0]) Log.i("MeetifyyLaunch", "page painted at +" + sinceProcessStart() + "ms");
                start.run();
            }
        });
    }

    /**
     * Reveals the page, which is painted beneath the splash (see
     * exitSplashOncePainted). The page is told as the reveal starts, so its own
     * entrance plays under it.
     *
     * The logo leaves first: it shrinks slightly and fades over 100 ms, fastest
     * at the start, and the background starts fading 55 ms in, when the logo
     * is about 80% gone. By the time the page shows through, the logo has
     * left, so there is no ghosted logo over the feed (what fading the whole
     * view at once looked like), and the page follows the logo closely enough
     * that there is no blank pause between them (what cutting the logo at once
     * and then fading looked like). Both are view properties on hardware
     * layers: nothing is re-laid out or re-rastered per frame.
     *
     * The logo is pinned for the duration: the page repaints the system bars
     * as the splash lifts, and a change in their insets re-lays out the splash
     * view, which could move the centred logo upward in the last frames. Any
     * such shift is cancelled with an equal and opposite translation.
     */
    private void fadeSplashOut(SplashScreenViewProvider provider) {
        if (isFinishing() || isDestroyed()) {
            provider.remove();
            return;
        }
        final View splashView = provider.getView();
        // The launch's splash tells the page (its opening screen waits for it);
        // a later one, on a warm return, only has to leave.
        final boolean launch = !splashRevealing;
        if (launch) notifySplashExiting();
        splashRevealing = true;
        if (isDebuggable()) Log.i("MeetifyyLaunch", (launch ? "splash" : "warm-start splash") + " reveal starts at +" + sinceProcessStart() + "ms");
        if (pendingFullyDrawn != null) {
            final String what = pendingFullyDrawn;
            pendingFullyDrawn = null;
            onPageFullyDrawn(what);
        }
        if (splashView == null) {
            provider.remove();
            if (launch) notifySplashExited();
            return;
        }
        View icon = provider.getIconView();
        if (icon == null) icon = findSplashIcon(splashView);
        if (icon != null) {
            icon.animate()
                .alpha(0f)
                .scaleX(SPLASH_ICON_EXIT_SCALE)
                .scaleY(SPLASH_ICON_EXIT_SCALE)
                .setDuration(SPLASH_ICON_EXIT_MS)
                .setInterpolator(new DecelerateInterpolator())
                .withLayer()
                .start();
        }
        splashView.animate()
            .alpha(0f)
            .setStartDelay(SPLASH_BACKGROUND_DELAY_MS)
            .setDuration(SPLASH_BACKGROUND_EXIT_MS)
            .setInterpolator(new DecelerateInterpolator())
            .withLayer()
            .withEndAction(() -> {
                provider.remove();
                if (launch) notifySplashExited();
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
        // (resize, prefers-color-scheme), which repaints the bars itself. The
        // icons are the exception: a night-mode change re-tints them to the
        // theme's default, so the page's choice is put back, now and once the
        // change has finished being dispatched.
        if (contentPainted) {
            SystemUiHelper.reapplyPageIcons(this);
            handler.post(() -> SystemUiHelper.reapplyPageIcons(this));
            return;
        }
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

    /**
     * Hands the user's theme to the system as the app leaves the screen.
     *
     * The system draws the next cold start's splash from the night mode it
     * holds for the app (SystemUiHelper.syncSystemNightMode), so that has to
     * follow the user's choice — but setting it is a configuration change on
     * the running activity, and doing it when the user picked the theme landed
     * in the middle of the theme reveal (icons re-tinted by the system, the
     * WebView re-evaluating its colour scheme while the circle grew). Nothing
     * visible needs it; only the next cold start does, and every ordinary path
     * to one passes through here first: Home, Back, the recents screen (an
     * app swiped away from recents was already stopped when recents opened),
     * the system killing a backgrounded process.
     *
     * The edge: a process that dies while in the FOREGROUND (a crash, a force
     * stop from settings, adb) never reaches onStop after a theme change. The
     * next cold start's SYSTEM splash is then drawn in the previous night mode
     * — one launch with the old flicker. Everything after it is still right:
     * onCreate resolves the theme from the preferences, which setColors
     * commits synchronously at the moment of the choice, applies the matching
     * launch theme and window colour, and syncs the system night mode itself
     * (applyNightModeAndLaunchTheme), so the launch after that is clean too.
     */
    @Override
    public void onStop() {
        super.onStop();
        final android.content.SharedPreferences prefs =
            getSharedPreferences(SystemUiHelper.PREFS, MODE_PRIVATE);
        final boolean chosen = prefs.getBoolean(SystemUiHelper.KEY_PREFERENCE_SET, false);
        final String theme = prefs.getString(SystemUiHelper.KEY_THEME, "system");
        // No-op when unchanged (the common case: it remembers what it last
        // handed the system), so this costs a preference read per onStop.
        SystemUiHelper.syncSystemNightMode(this, chosen ? theme : "system");
    }

    /**
     * The WebView's renderer process is gone, and with it the page.
     *
     * Nothing handled this before, and WebView's default is to end the app:
     * "Render process's crash wasn't handled by all associated webviews,
     * triggering application crash". The common case is not a bug at all: while
     * the user is in another app (Chrome, opening a link), the system reclaims
     * the renderer for memory, the app dies with it, and the way back is a cold
     * start that loses the screen they were on.
     *
     * A WebView whose renderer is gone cannot be used again, and Capacitor's
     * bridge cannot be given a new one, so the activity is recreated: a new
     * bridge, a new WebView, the page loaded again. It happens at once, in the
     * background if that is where the app is, so the page is ready when the
     * user returns.
     *
     * Where the system reclaimed the renderer, the page reopens where it was
     * (same origin only). Where the renderer CRASHED, it reopens at the start:
     * reloading the page that crashed it can crash it again. Repeated losses
     * are not recovered forever: past MAX_RENDERER_RECOVERIES within
     * RENDERER_LOSS_WINDOW_MS the default applies and the process ends.
     *
     * @return true when the loss is handled here
     */
    private boolean onRendererLost(WebView view, RenderProcessGoneDetail detail) {
        // Only the WebView on screen is recovered (and counted). Any other has
        // nothing to show and is only put away.
        final WebView current = getBridge() != null ? getBridge().getWebView() : null;
        if (view != current || isFinishing() || isDestroyed()) {
            discardWebView(view);
            return true;
        }
        final long now = SystemClock.uptimeMillis();
        while (!rendererLosses.isEmpty() && now - rendererLosses.peekFirst() > RENDERER_LOSS_WINDOW_MS) {
            rendererLosses.pollFirst();
        }
        final boolean crashed = detail != null && detail.didCrash();
        if (rendererLosses.size() >= MAX_RENDERER_RECOVERIES) {
            Log.w(WEBVIEW_TAG, "renderer lost " + (rendererLosses.size() + 1) + " times within a minute; not recovering");
            return false;
        }
        rendererLosses.addLast(now);
        Log.w(WEBVIEW_TAG, "renderer " + (crashed ? "crashed" : "reclaimed by the system") + "; recreating the page");

        // A second loss in the window reopens at the start too, whatever caused it.
        restoreUrl = !crashed && rendererLosses.size() == 1 ? sameOriginUrl(view) : null;
        recoveryStartedAt = now;
        if (isDebuggable()) Log.i(WEBVIEW_TAG, restoreUrl != null ? "reopening the page it was on" : "reopening at the start");

        discardWebView(view);
        handler.removeCallbacksAndMessages(null);
        recreate();
        return true;
    }

    /**
     * Out of the window and destroyed, here and now (as Android's own sample
     * for this callback does). Not left to Capacitor: it destroys its WebView
     * when the activity's window detaches, and recreate() keeps the window, so
     * the dead WebView outlived its activity. It then shared the next renderer
     * with the new one and reported that renderer's loss a second time
     * (measured on the I2208: two reports 6 ms apart, the second of which
     * discarded the page to reopen). A destroyed WebView ignores later calls,
     * so the old bridge's plugins can still touch it while they shut down.
     */
    private static void discardWebView(WebView view) {
        if (view == null) return;
        final ViewGroup parent = view.getParent() instanceof ViewGroup ? (ViewGroup) view.getParent() : null;
        if (parent != null) parent.removeView(view);
        view.destroy();
    }

    /**
     * The page on screen when the renderer went: the committed entry of the
     * WebView's history (the app's own routes are entries too), not getUrl(),
     * which reports a navigation still in progress. Only if it is the app's own.
     */
    private String sameOriginUrl(WebView view) {
        try {
            final android.webkit.WebHistoryItem item = view.copyBackForwardList().getCurrentItem();
            final String url = item != null ? item.getUrl() : null;
            final String app = getBridge() != null ? getBridge().getAppUrl() : null;
            if (url == null || app == null) return null;
            final android.net.Uri page = android.net.Uri.parse(url);
            final android.net.Uri base = android.net.Uri.parse(app);
            final boolean same = page.getScheme() != null && page.getScheme().equals(base.getScheme())
                && page.getAuthority() != null && page.getAuthority().equals(base.getAuthority());
            return same ? url : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * The activity recreated after a renderer loss (onRendererLost).
     *
     * Its intent is still the one that first launched it, and the bridge reads
     * that intent and replays it to every plugin as it loads: a deep link
     * opened an hour ago, or a notification tap, would fire again and take the
     * user away from where they were. It starts from a plain launch instead.
     * Then, once the bridge has started loading the start page, the page the
     * user was on replaces it, before anything of the first has been fetched.
     */
    @Override
    protected void load() {
        final boolean recovering = recoveryStartedAt != 0
            && SystemClock.uptimeMillis() - recoveryStartedAt <= RECOVERY_TTL_MS;
        final String url = recovering ? restoreUrl : null;
        recoveryStartedAt = 0;
        restoreUrl = null;
        if (recovering) {
            setIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClass(this, MainActivity.class));
        }
        super.load();
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (url != null && webView != null) webView.loadUrl(url);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
