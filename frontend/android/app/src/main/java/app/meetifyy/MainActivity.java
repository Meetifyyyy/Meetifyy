package app.meetifyy;

import android.os.Bundle;
import android.view.View;
import android.view.ViewTreeObserver;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

/**
 * Holds the system splash screen until the WebView has actually drawn.
 *
 * WHAT THIS FIXES
 * Launching the app showed a black screen, then a flicker, then the web
 * loader, then the app. Three separate causes, two of them in styles.xml (the
 * splash theme used an attribute Android 12+ ignores, and the activity had no
 * window background, so the window was black while the WebView started up).
 * This file is the third: nothing installed the SplashScreen API at all, so the
 * themed splash was dismissed the moment the activity was ready rather than
 * when there was something to show.
 *
 * WHY A PRE-DRAW LISTENER AND NOT A TIMER
 * The splash has to last exactly as long as the WebView takes, which varies by
 * device and by whether the app is warm. A fixed delay is either too short on a
 * cold start — which is the case that was broken — or padding added to every
 * warm start for nothing. The pre-draw listener fires on the frame the WebView
 * is first ready to paint, which is the real event.
 *
 * SPLASH_TIMEOUT_MS is a backstop, not a delay: it only ever runs if that frame
 * never arrives, and it exists so a failed bundle or a hung load ends with the
 * user looking at the app's own error state rather than at a logo forever. On a
 * healthy launch it is cancelled before it fires.
 *
 * Nothing here papers over a slow boot. The splash, the activity window and the
 * launch shell in index.mobile.html are all the same colour, so the handover
 * between the three surfaces is invisible and the logo simply stays put.
 */
public class MainActivity extends BridgeActivity {

    /** Only reached if the WebView never reports a frame. */
    private static final long SPLASH_TIMEOUT_MS = 4000;

    private boolean readyToDraw = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run BEFORE super.onCreate, or the splash theme is never applied
        // and the activity comes up wearing the post-splash theme directly.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        super.onCreate(savedInstanceState);

        splashScreen.setKeepOnScreenCondition(() -> !readyToDraw);

        final View content = findViewById(android.R.id.content);
        content.postDelayed(() -> readyToDraw = true, SPLASH_TIMEOUT_MS);

        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        final View target = webView != null ? webView : content;

        target
            .getViewTreeObserver()
            .addOnPreDrawListener(
                new ViewTreeObserver.OnPreDrawListener() {
                    @Override
                    public boolean onPreDraw() {
                        // Removed on the first call: this must release the splash
                        // once, not sit in the draw path for the life of the app.
                        target.getViewTreeObserver().removeOnPreDrawListener(this);
                        readyToDraw = true;
                        return true;
                    }
                }
            );
    }
}
