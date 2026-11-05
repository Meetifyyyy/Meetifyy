package app.meetifyy;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
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

    /** A moving page's corner radius, CSS px; JS may override it (`cornerRadius`). */
    static final float DEFAULT_CORNER_RADIUS_CSS = 20f;

    /**
     * The picture as a paint, for drawing it into a rounded shape. Built once
     * per bitmap; only its matrix changes per frame (no allocation).
     */
    static final class PicturePaint {
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Matrix matrix = new Matrix();
        private Bitmap shaderFor;

        Paint forBitmap(Bitmap b, float dx, float dy) {
            if (shaderFor != b) {
                paint.setShader(new BitmapShader(b, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
                shaderFor = b;
            }
            matrix.setTranslate(dx, dy);
            paint.getShader().setLocalMatrix(matrix);
            return paint;
        }
    }

    /**
     * The two wedges OUTSIDE a rounded left edge: what is cut off the top-left
     * and bottom-left corners of a page whose left edge is at `x`. Filled with
     * the page beneath, they make the page above look rounded without clipping
     * it. `path` and `oval` are reused, so nothing is allocated.
     */
    static void leftCornerWedges(Path path, RectF oval, float x, float height, float r) {
        path.reset();
        if (r <= 0f) return;
        // Top-left.
        path.moveTo(x, 0f);
        path.lineTo(x + r, 0f);
        oval.set(x, 0f, x + 2f * r, 2f * r);
        path.arcTo(oval, 270f, -90f, false);
        path.close();
        // Bottom-left.
        path.moveTo(x, height);
        path.lineTo(x, height - r);
        oval.set(x, height - 2f * r, x + 2f * r, height);
        path.arcTo(oval, 180f, -90f, false);
        path.close();
    }

    static double number(PluginCall call, String key, double fallback) {
        final Double value = call.getDouble(key);
        return value == null || value.isNaN() || value.isInfinite() ? fallback : value;
    }

    static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
