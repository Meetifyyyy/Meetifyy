package app.meetifyy;

import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;

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
        applyLaunchBackground(resolvedTheme.isDark);

        final int splashColor = resolvedTheme.isDark ? SystemUiHelper.COLOR_DARK : SystemUiHelper.COLOR_LIGHT;
        if (getWindow() != null && getWindow().getDecorView() != null) {
            findAndColorSplashView(getWindow().getDecorView(), splashColor);
            getWindow().getDecorView().post(() -> {
                findAndColorSplashView(getWindow().getDecorView(), splashColor);
            });
        }

        splashScreen.setOnExitAnimationListener(provider -> {
            if (provider != null && provider.getView() != null) {
                provider.getView().setBackgroundColor(splashColor);
                findAndColorSplashView(provider.getView(), splashColor);
            }

            final SystemUiHelper.ResolvedTheme currentTheme = SystemUiHelper.resolveTheme(this);
            SystemUiHelper.applySystemBars(this, currentTheme.isDark, null);
            applyLaunchBackground(currentTheme.isDark);

            final long deadline = SystemClock.uptimeMillis() + SPLASH_TIMEOUT_MS;
            handler.post(new Runnable() {
                private boolean themeSynced = false;

                @Override
                public void run() {
                    if (contentPainted || SystemClock.uptimeMillis() >= deadline) {
                        if (provider != null) {
                            provider.remove();
                        }
                        return;
                    }

                    final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                    if (webView == null) {
                        handler.postDelayed(this, POLL_INTERVAL_MS);
                        return;
                    }

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
                    webView.evaluateJavascript(
                        "(function(){try{return !!(window.__meetifyyBoot && window.__meetifyyBoot.appReady)}"
                            + "catch(e){return false}})()",
                        value -> {
                            if ("true".equals(value)) {
                                contentPainted = true;
                                if (provider != null) {
                                    provider.remove();
                                }
                            } else {
                                handler.postDelayed(self, POLL_INTERVAL_MS);
                            }
                        }
                    );
                }
            });
        });
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
        final SystemUiHelper.ResolvedTheme currentTheme = SystemUiHelper.resolveTheme(this);
        SystemUiHelper.applySystemBars(this, currentTheme.isDark, null);
        applyLaunchBackground(currentTheme.isDark);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        final SystemUiHelper.ResolvedTheme currentTheme = SystemUiHelper.resolveTheme(this);

        // If the user explicitly chose Light or Dark, device changes must NOT override the app
        if (currentTheme.preferenceSet) {
            SystemUiHelper.applySystemBars(this, currentTheme.isDark, null);
            applyLaunchBackground(currentTheme.isDark);
        } else {
            // System mode: follow device configuration change
            final boolean deviceIsDark =
                (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            SystemUiHelper.applySystemBars(this, deviceIsDark, null);
            applyLaunchBackground(deviceIsDark);
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
