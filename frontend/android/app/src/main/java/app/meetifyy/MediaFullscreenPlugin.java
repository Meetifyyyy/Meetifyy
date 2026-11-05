package app.meetifyy;

import android.app.Activity;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Fullscreen for the media viewer's video player.
 *
 * The web Fullscreen API cannot do this inside the app: Capacitor's
 * BridgeWebChromeClient answers every onShowCustomView by calling
 * onCustomViewHidden() at once, so the WebView left fullscreen in the frame it
 * entered it. The viewer already covers the WebView, so what fullscreen still
 * has to add is the window's part, which only the shell can do:
 *
 *  - the status and navigation bars hidden (immersive; a swipe from an edge
 *    brings them back for a moment, as in any video app);
 *  - (no rotation: the app is portrait-only, MainActivity in the manifest,
 *    so a wide clip plays letterboxed rather than turning the screen);
 *  - the screen kept on while it plays.
 *
 * {@link #exit} puts both back exactly as they were, and so does the
 * activity going away, so the app can never be left without its bars.
 */
@CapacitorPlugin(name = "MediaFullscreen")
public class MediaFullscreenPlugin extends Plugin {

    private boolean active = false;

    /** `landscape` is accepted and ignored: the app never leaves portrait. */
    @PluginMethod
    public void enter(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() -> {
            active = true;
            final Window window = activity.getWindow();
            final WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void exit(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            restore(activity);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        final Activity activity = getActivity();
        if (activity != null) restore(activity);
    }

    private void restore(Activity activity) {
        if (!active) return;
        active = false;
        final Window window = activity.getWindow();
        WindowCompat.getInsetsController(window, window.getDecorView())
                .show(WindowInsetsCompat.Type.systemBars());
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
