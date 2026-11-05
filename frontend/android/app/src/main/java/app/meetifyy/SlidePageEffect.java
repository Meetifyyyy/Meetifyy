package app.meetifyy;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
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
 * ROUNDED LEADING CORNERS
 * While it moves, the top page's two visible corners (its left edge; the right
 * ones are off screen) are rounded, flattening to square as it settles so a
 * page at rest is never rounded. Opening, the top page is the live WebView,
 * which is not clipped (that would cost the page a layer): the page beneath —
 * picture and dim — is painted into the two wedges outside the round, over the
 * WebView, which reads as the same thing. Closing, the top page is the picture,
 * drawn as a rounded rectangle through a BitmapShader, anti-aliased, with the
 * dim carried into the wedges so the corners show the dimmed page beneath.
 *
 * JS (shared/lib/navigation/slideTransition.js) passes: parallax (fraction of
 * the width), dim (alpha 0-1 at full cover), shadowWidth (CSS px), shadowAlpha
 * (alpha 0-1), and optionally cornerRadius (CSS px, 0 for square corners).
 */
final class SlidePageEffect extends PageEffect {

    private static final float MAX_SHADOW_WIDTH_CSS = 64f;
    /** The shadow reaches full strength once the top page covers this much of the screen. */
    private static final float SHADOW_FADE_SPAN = 0.3f;
    /** The corners are fully round until the top page has this much left to cover. */
    private static final float CORNER_SETTLE_SPAN = 0.25f;

    private final Paint bitmapPaint = new Paint();
    private final Paint dimPaint = new Paint();
    private final Paint shadowPaint = new Paint();
    private final PicturePaint picturePaint = new PicturePaint();
    private final Path wedges = new Path();
    private final RectF oval = new RectF();
    private final RectF topRect = new RectF();

    // Per play.
    private boolean opening;
    private int pageLeft;
    private int pageWidth;
    private float parallax;
    private float dim;
    private float shadowWidth;
    private float shadowAlpha;
    private float cornerRadius;

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
        cornerRadius = (float) clamp(number(call, "cornerRadius", DEFAULT_CORNER_RADIUS_CSS), 0, 48) * stage.density;
        dimPaint.setAntiAlias(true);
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
        // Round while moving, square once the top page has settled.
        final float r = edge > 0 && edge < width
            ? cornerRadius * Math.min(1f, (1f - pose) / CORNER_SETTLE_SPAN)
            : 0f;
        if (r > 0f) leftCornerWedges(wedges, oval, edge, height, r);

        if (opening && edge > 0) {
            // The page beneath: the picture, drifted left, up to the top page's edge.
            final int save = canvas.save();
            canvas.clipRect(0, 0, edge, height);
            canvas.drawBitmap(b, under, 0f, bitmapPaint);
            canvas.restoreToCount(save);
            // ...and in the wedges outside the live page's rounded corners.
            if (r > 0f) canvas.drawPath(wedges, picturePaint.forBitmap(b, under, 0f));
        }
        // The dim over the page beneath (the picture, or the live WebView under it).
        final int dimAlpha = Math.round(255f * dim * pose);
        if (dimAlpha > 0 && edge > 0) {
            dimPaint.setAlpha(dimAlpha);
            canvas.drawRect(0f, 0f, edge, height, dimPaint);
            if (r > 0f) canvas.drawPath(wedges, dimPaint);
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
            if (r > 0f) {
                // Rounded on its left; its right side is off the screen.
                topRect.set(edge, 0f, edge + pageWidth + r, height);
                canvas.drawRoundRect(topRect, r, r, picturePaint.forBitmap(b, edge - pageLeft, 0f));
            } else {
                final int save = canvas.save();
                canvas.clipRect(edge, 0, width, height);
                canvas.drawBitmap(b, edge - pageLeft, 0f, bitmapPaint);
                canvas.restoreToCount(save);
            }
        }
    }
}
