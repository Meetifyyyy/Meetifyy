package app.meetifyy;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.webkit.WebView;

import com.getcapacitor.PluginCall;

/**
 * One way a page opens over the one beneath it and closes back onto it
 * (PageTransitionPlugin). The plugin owns everything that is the same whatever
 * the motion: the screenshot, the one animator, turning round, icons, teardown.
 * An effect owns only what looks different:
 *
 *   SlidePageEffect    the new page slides in from the right over the other
 *   CentrePageEffect   the new page opens out of the middle of the screen
 *
 * Both are driven by one number, the POSE: how much of the screen the top page
 * has taken (0 = not there yet, 1 = covering it). Opening plays 0 -> 1, closing
 * 1 -> 0, so a close is exactly an open run backwards and turning round mid-way
 * is just a new target for the same number.
 *
 * Opening, the live WebView is the top page and the screenshot is the page
 * beneath; closing, the screenshot is the top page and the live WebView is the
 * page beneath. The page being gone TO is always the live WebView, so it keeps
 * loading and painting while it moves.
 *
 * UI thread only. Nothing here may allocate per frame.
 */
abstract class PageEffect {

    /** Where everything is, in the host window's pixels, measured with the WebView at rest. */
    static final class Stage {
        final int hostWidth;
        final int hostHeight;
        final int pageLeft;
        final int pageTop;
        final int pageWidth;
        final int pageHeight;
        final float density;

        Stage(int hostWidth, int hostHeight, int pageLeft, int pageTop,
              int pageWidth, int pageHeight, float density) {
            this.hostWidth = hostWidth;
            this.hostHeight = hostHeight;
            this.pageLeft = pageLeft;
            this.pageTop = pageTop;
            this.pageWidth = pageWidth;
            this.pageHeight = pageHeight;
            this.density = density;
        }
    }

    /**
     * Called once per play, before anything moves: read this effect's own
     * arguments from `call`, and leave the picture posed at the start (the
     * pose 0 of an open, 1 of a close), where it looks exactly like the plain
     * screenshot did.
     */
    abstract void configure(PluginCall call, Stage stage, boolean opening);

    /** Puts both pages where `pose` says: the WebView now, the picture on the next draw. */
    abstract void apply(WebView web, float pose);

    /** Draws the picture, which is the other page, as `apply` last posed it. */
    abstract void draw(Canvas canvas, Bitmap picture, int width, int height);

    static double number(PluginCall call, String key, double fallback) {
        final Double value = call.getDouble(key);
        return value == null || value.isNaN() || value.isInfinite() ? fallback : value;
    }

    static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
