package app.meetifyy;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.webkit.WebView;

import com.getcapacitor.PluginCall;

/**
 * The slide: the new page slides in from the right edge over the current one,
 * which drifts left by a fraction of its width and dims, with a soft shadow
 * along the new page's leading edge. Closing is the same motion played the
 * other way: the top page slides off to the right, and the page beneath comes
 * back from the left as its dim lifts.
 *
 *   open   WebView    = the top page, sliding in from the right
 *          picture    = the page beneath, drifting left and dimming
 *   close  picture    = the top page, sliding out to the right
 *          WebView    = the page beneath, drifting back as the dim lifts
 *
 * Every position is rounded to whole device pixels, the WebView's and the
 * picture's alike, so the two edges always meet with no seam and the picture
 * is never resampled.
 *
 * JS (shared/lib/navigation/slideTransition.js) passes: parallax (fraction of
 * the width), dim (alpha 0-1 at full cover), shadowWidth (CSS px), shadowAlpha
 * (alpha 0-1).
 */
final class SlidePageEffect extends PageEffect {

    private static final float MAX_SHADOW_WIDTH_CSS = 64f;
    /** The shadow reaches full strength once the top page covers this much of the screen. */
    private static final float SHADOW_FADE_SPAN = 0.3f;

    private final Paint bitmapPaint = new Paint();
    private final Paint dimPaint = new Paint();
    private final Paint shadowPaint = new Paint();

    // Per play.
    private boolean opening;
    private int pageLeft;
    private int pageWidth;
    private float parallax;
    private float dim;
    private float shadowWidth;
    private float shadowAlpha;

    // Per frame, device px in the host's coordinates.
    private float pose;
    /** The top page's left edge. */
    private int edge;
    /** The page beneath's offset from its resting place (zero or negative). */
    private int under;

    SlidePageEffect() {
        dimPaint.setColor(Color.BLACK);
    }

    @Override
    void configure(PluginCall call, Stage stage, boolean opening) {
        this.opening = opening;
        pageLeft = stage.pageLeft;
        pageWidth = stage.pageWidth;
        parallax = (float) clamp(number(call, "parallax", 0.3), 0, 1);
        dim = (float) clamp(number(call, "dim", 0.12), 0, 1);
        shadowWidth = (float) clamp(number(call, "shadowWidth", 16), 0, MAX_SHADOW_WIDTH_CSS) * stage.density;
        shadowAlpha = (float) clamp(number(call, "shadowAlpha", 0.12), 0, 1);
        if (shadowWidth > 0f) {
            // Falls off quickly from the edge, like a page lifted just off
            // the one beneath it. Full strength here; scaled per frame by
            // the paint's alpha.
            shadowPaint.setShader(new LinearGradient(
                0f, 0f, shadowWidth, 0f,
                new int[] { 0x00000000, 0x14000000, 0x52000000, 0xFF000000 },
                new float[] { 0f, 0.45f, 0.8f, 1f },
                Shader.TileMode.CLAMP));
        } else {
            shadowPaint.setShader(null);
        }
        pose = opening ? 0f : 1f;
        edge = Math.round(pageLeft + (opening ? pageWidth : 0));
        under = 0;
    }

    @Override
    void apply(WebView web, float pose) {
        // Whole device pixels, computed once and used for both pages.
        final int edgeOffset = Math.round(pageWidth * (1f - pose));
        final int underOffset = -Math.round(parallax * pageWidth * pose);
        web.setTranslationX(opening ? edgeOffset : underOffset);
        this.edge = pageLeft + edgeOffset;
        this.under = underOffset;
        this.pose = pose;
    }

    @Override
    void draw(Canvas canvas, Bitmap b, int width, int height) {
        if (opening && edge > 0) {
            // The page beneath: the picture, drifted left, up to the top page's edge.
            final int save = canvas.save();
            canvas.clipRect(0, 0, edge, height);
            canvas.drawBitmap(b, under, 0f, bitmapPaint);
            canvas.restoreToCount(save);
        }
        // The dim over the page beneath (the picture, or the live WebView under it).
        final int dimAlpha = Math.round(255f * dim * pose);
        if (dimAlpha > 0 && edge > 0) {
            dimPaint.setAlpha(dimAlpha);
            canvas.drawRect(0f, 0f, edge, height, dimPaint);
        }
        // The top page's shadow, faded in over the first stretch of cover
        // so it never appears or vanishes at full strength at the screen's edge.
        final int shadow = Math.round(255f * shadowAlpha * Math.min(1f, pose / SHADOW_FADE_SPAN));
        if (shadow > 0 && shadowWidth > 0f && edge > 0) {
            shadowPaint.setAlpha(shadow);
            final int save = canvas.save();
            canvas.translate(edge - shadowWidth, 0f);
            canvas.drawRect(0f, 0f, shadowWidth, height, shadowPaint);
            canvas.restoreToCount(save);
        }
        if (!opening && edge < width) {
            // The top page: the picture, slid right to the edge.
            final int save = canvas.save();
            canvas.clipRect(edge, 0, width, height);
            canvas.drawBitmap(b, edge - pageLeft, 0f, bitmapPaint);
            canvas.restoreToCount(save);
        }
    }
}
