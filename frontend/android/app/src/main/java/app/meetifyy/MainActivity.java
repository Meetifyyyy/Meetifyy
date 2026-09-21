package app.meetifyy;

import android.content.res.Configuration;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

/**
 * Holds the system splash until the web app has actually painted something.
 *
 * WHAT THE FIRST ATTEMPT GOT WRONG
 * It released the splash from a pre-draw listener on the WebView. That fires on
 * the WebView's first draw, which is its BLANK frame — the page has not
 * rendered yet — so the splash lifted onto an empty WebView. On a dark-mode
 * device that empty frame is black, which is the black screen in the recording,
 * and the launch shell then painted its logo a moment later. The logo appeared,
 * vanished into black, and appeared again.
 *
 * WHAT IT WAITS FOR NOW
 * The launch shell in `index.mobile.html` is the first thing the document
 * paints, so its presence in the DOM is the real "there is something behind the
 * splash" signal. Asking the page directly is the only way to know that; no
 * native view callback can see it.
 *
 * Polling rather than a plugin: a JavaScript interface to receive one boolean
 * would mean a bridge, a registered plugin and a contract to keep, for a signal
 * that is read a handful of times over half a second. The poll is cheap, it is
 * cancelled the moment it succeeds, and it is confined to this file.
 *
 * SPLASH_TIMEOUT_MS is a backstop, not a delay. It only ever runs if the page
 * never paints — a failed bundle, a hung load — so that the user ends up
 * looking at the app's own error state instead of a logo forever.
 *
 * THE BACKGROUND COLOUR IS SET THREE TIMES, ON PURPOSE
 * The splash, the activity window and the WebView are three separate surfaces,
 * and whichever is on top during a handover is what the user sees. They are all
 * `launchBackground`, which has a `values-night` variant, so on a dark-mode
 * phone none of them flashes white. The web layer paints the same value from
 * `localStorage.theme` before its first paint, so the shell agrees with them.
 */
public class MainActivity extends BridgeActivity {

    /** Only reached if the page never paints. */
    private static final long SPLASH_TIMEOUT_MS = 5000;

    /** Fast enough to be invisible, slow enough not to busy-wait the WebView. */
    private static final long POLL_INTERVAL_MS = 32;

    private boolean contentPainted = false;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run BEFORE super.onCreate, or the splash theme is never applied.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // Before super.onCreate: the bridge reads the registered plugins while
        // it is being built, so a plugin registered afterwards is not there
        // when the web layer first asks for it.
        registerPlugin(SystemUiPlugin.class);

        super.onCreate(savedInstanceState);

        splashScreen.setKeepOnScreenCondition(() -> !contentPainted);

        applyLaunchBackground();

        final long deadline = SystemClock.uptimeMillis() + SPLASH_TIMEOUT_MS;
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (contentPainted) return;

                if (SystemClock.uptimeMillis() >= deadline) {
                    contentPainted = true;
                    return;
                }

                final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    handler.postDelayed(this, POLL_INTERVAL_MS);
                    return;
                }

                final Runnable self = this;
                webView.evaluateJavascript(
                    "(function(){try{return !!document.getElementById('launch-shell')}catch(e){return false}})()",
                    value -> {
                        if ("true".equals(value)) {
                            contentPainted = true;
                        } else {
                            handler.postDelayed(self, POLL_INTERVAL_MS);
                        }
                    }
                );
            }
        });
    }

    /**
     * Paints the WebView itself, not just the window behind it.
     *
     * A WebView with no explicit background draws white, and in dark mode that
     * is a white rectangle over a dark window for the moment before the page
     * renders. Setting it here rather than in `capacitor.config.json` is what
     * allows it to follow the night-mode resource.
     */
    private void applyLaunchBackground() {
        final int color = ContextCompat.getColor(this, R.color.launchBackground);

        getWindow().setBackgroundDrawableResource(R.color.launchBackground);

        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(color);
        }
    }

    /**
     * Follows a theme change made while the app is alive.
     *
     * Without this, switching the phone to dark mode leaves the WebView holding
     * the light colour it was given at launch, which shows on the next cold
     * frame.
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyLaunchBackground();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
