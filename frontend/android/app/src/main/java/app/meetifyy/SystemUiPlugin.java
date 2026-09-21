package app.meetifyy;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the status bar and the navigation bar to match the app's own theme.
 *
 * WHY THIS EXISTS RATHER THAN A DEPENDENCY
 * Capacitor 8's built-in `SystemBars` plugin can only set the STYLE of the bars
 * — whether their icons are light or dark. It has no way to set their
 * background, because Android 15 expects an app to draw behind the bars instead
 * of colouring them. This app does not: the WebView is inset by the safe areas,
 * so the strips above and below it show the window background, and that was a
 * white band above and below a dark app.
 *
 * WHY THE OS THEME IS THE WRONG SOURCE
 * `values-night` was the obvious fix and it is not enough. The app has its own
 * theme toggle, so someone can run the app in dark while the phone is in light
 * — which is exactly the screenshot this was reported from. A resource
 * qualifier answers "what is the PHONE set to"; the only thing that knows what
 * the APP is set to is the web layer. So the colour is pushed from there.
 *
 * `setStatusBarColor` and `setNavigationBarColor` are deprecated on API 35+,
 * where they are ignored in favour of edge-to-edge. They are still the correct
 * call on everything this app supports (minSdk 24), and the window background
 * is set alongside them so the same colour is used on a platform that ignores
 * them.
 */
@CapacitorPlugin(name = "SystemUi")
public class SystemUiPlugin extends Plugin {

    /**
     * @param call `background` a CSS-style colour string, and `lightIcons`:
     *             true when the bars sit on a dark colour and their icons must
     *             be light.
     */
    @PluginMethod
    public void setColors(PluginCall call) {
        final String background = call.getString("background");
        final boolean lightIcons = Boolean.TRUE.equals(call.getBoolean("lightIcons", false));

        if (background == null || background.isEmpty()) {
            call.reject("background is required");
            return;
        }

        final int color;
        try {
            color = Color.parseColor(background);
        } catch (IllegalArgumentException e) {
            // A colour the web layer computed to something Android cannot read.
            // Rejecting rather than guessing: a wrong colour here is a visible
            // band across the top of the screen.
            call.reject("unparseable colour: " + background);
            return;
        }

        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }

        activity.runOnUiThread(() -> {
            final Window window = activity.getWindow();
            final View decor = window.getDecorView();

            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(color));

            // `isAppearanceLight*` means "dark icons for a light background",
            // which is the inverse of what the caller describes, hence the flip.
            final WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(window, decor);
            controller.setAppearanceLightStatusBars(!lightIcons);
            controller.setAppearanceLightNavigationBars(!lightIcons);

            call.resolve();
        });
    }
}
