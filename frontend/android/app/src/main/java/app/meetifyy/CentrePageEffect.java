package app.meetifyy;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Build;
import android.webkit.WebView;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSArray;
import com.getcapacitor.PluginCall;

import org.json.JSONObject;

/**
 * The centre opening, about the middle of the screen. Opening, the page being
 * left grows and dissolves to show the new page; closing, the page being closed
 * shrinks and dissolves to show the one it was opened from: opposite ways.
 *
 *   open   picture    = the page being left, growing, dissolving
 *          WebView    = the new page, at rest
 *   close  picture    = the page being closed, shrinking, dissolving
 *          WebView    = the page beneath, at rest
 *
 * THE LIVE PAGE DOES NOT MOVE. Only the picture, one texture drawn by the GPU,
 * is scaled and faded. The first version scaled the WebView itself on open
 * (X's new page settles from 1.15x), and the opening was the part that felt
 * janky. A view transform reaches Chromium from outside the page, and its
 * compositor re-rasters a layer whenever the scale it is shown at differs at
 * all from the one it was rastered at (PictureLayerImpl::ShouldAdjustRasterScale
 * holds the old scale only for CSS animations and will-change): scaling the
 * WebView for 19 frames means rastering the page again on each, on the same
 * renderer that is busy building the page being opened. `liveScale` still turns
 * that on, so it can be compared on a device; it is 1 (off) by default.
 *
 * With the pose `s` (0 = new page not there, 1 = covering the screen) and the
 * motion's progress p (s opening, 1 - s closing), the picture is at scale
 * 1 + (pictureScale - 1)p about the centre of the window, the only pivot that
 * fitted X's own motion (the tap point and the top edge did far worse).
 *
 * ONLY THE CLOSING PICTURE IS EVER SMALLER THAN THE SCREEN. It is drawn over
 * the live page it returns to, which fills the window, so round it is that page.
 * A page beneath shrunk (X's goes to about 0.95) shows what is round it instead,
 * which here is not X's black: opening, the new page (its own background, or a
 * cover colour), closing, the window's own background, the bottom-edge colour of
 * whichever page was last on screen (SystemUiHelper). Either way a band of
 * another page's colour showed round the page on three sides, on the Campus page
 * most of all. So the WebView and the opening picture are never below 1.
 *
 * HOW IT IS DRAWN
 * The picture is drawn over the WebView, so the dissolve is made by fading the
 * picture alone and letting the WebView show through: no alpha on the live
 * page, which would make the WebView render into an offscreen layer. Nothing
 * else is drawn: one textured quad per frame, and the WebView's own.
 *
 * The picture's opacity is 1 - smoothstep(progress / fadeEnd), where progress
 * is the pose opening and 1 - pose closing: eased at both ends so it neither
 * pops in the first frames nor leaves a ghost in the last, and finished at
 * `fadeEnd` so the page being left is gone before the motion is.
 *
 * ELEMENTS THAT DISSOLVE EARLY (closing only)
 * On close the picture is the page being left, drawn over the live page it
 * returns to. A control that exists in both (a post's four action buttons are
 * in the feed too) shows twice while the picture is still visible. JS sends the
 * rectangles of those controls (`fadeEarly`, CSS px, measured as the page was
 * pictured) and the picture is drawn in two parts: everything outside them at
 * the page's opacity, and the rectangles at their own, finishing at
 * `earlyFadeEnd`. This is the only place the picture is drawn more than once.
 *
 * With `liveScale` above 1 the WebView is scaled by the view's own transform,
 * about the window's centre through the view's default pivot (its own centre)
 * plus a translation that moves it: no explicit pivot is ever set, so there is
 * nothing to put back afterwards but scale and translation.
 *
 * JS (shared/lib/navigation/centreTransition.js) passes: pictureScale (the
 * picture's size at the end, >= 1 opening, <= 1 closing), fadeEnd (0-1), opening only: liveScale (the
 * new page's size when it starts, >= 1, 1 = not moved), and closing only:
 * earlyFadeEnd (0-1), fadeEarly ([{x, y, width, height}]).
 */
final class CentrePageEffect extends PageEffect {

    private static final float MAX_SCALE = 2f;
    /** How small the closing picture may get; it has the live page round it. */
    private static final float MIN_CLOSING_SCALE = 0.5f;
    /** More than this is a page marking everything; the rest are ignored. */
    private static final int MAX_EARLY_RECTS = 16;

    private final Paint bitmapPaint = new Paint();

    // Per play.
    private boolean opening;
    private float pictureEndScale;
    /** The live page's starting scale when opening; 1 leaves the WebView alone. */
    private float liveScale;
    private float fadeEnd;
    private float earlyFadeEnd;
    /** The window's centre relative to the WebView's own centre, in px. */
    private float offsetX;
    private float offsetY;
    /** left, top, right, bottom of each early rectangle, in the picture's pixels. */
    private final float[] earlyRects = new float[MAX_EARLY_RECTS * 4];
    private int earlyCount;

    // Per frame.
    private float pictureScale;
    private float pictureAlpha;
    private float earlyAlpha;

    CentrePageEffect() {
        // The picture is drawn scaled; without this HWUI would not filter it.
        bitmapPaint.setFilterBitmap(true);
    }

    @Override
    void configure(PluginCall call, Stage stage, boolean opening) {
        this.opening = opening;
        pictureEndScale = opening
                ? (float) clamp(number(call, "pictureScale", 1.1), 1, MAX_SCALE)
                : (float) clamp(number(call, "pictureScale", 0.9), MIN_CLOSING_SCALE, 1);
        liveScale = opening ? (float) clamp(number(call, "liveScale", 1), 1, MAX_SCALE) : 1f;
        fadeEnd = (float) clamp(number(call, "fadeEnd", 0.75), 0.05, 1);
        earlyFadeEnd = (float) clamp(number(call, "earlyFadeEnd", 0.35), 0.05, 1);
        // The window's centre in the WebView's own coordinates, minus the
        // WebView's centre. Zero when the WebView fills the window.
        offsetX = (stage.hostWidth / 2f - stage.pageLeft) - stage.pageWidth / 2f;
        offsetY = (stage.hostHeight / 2f - stage.pageTop) - stage.pageHeight / 2f;
        readEarlyRects(call, stage);
        poseFields(opening ? 0f : 1f);
    }

    /** JS's rectangles (CSS px in the WebView) as device px in the picture. Closing only. */
    private void readEarlyRects(PluginCall call, Stage stage) {
        earlyCount = 0;
        if (opening) return;
        final JSArray rects = call.getArray("fadeEarly");
        if (rects == null) return;
        final int n = Math.min(rects.length(), MAX_EARLY_RECTS);
        for (int i = 0; i < n; i++) {
            final JSONObject rect = rects.optJSONObject(i);
            if (rect == null) continue;
            final double width = rect.optDouble("width", 0);
            final double height = rect.optDouble("height", 0);
            if (!(width > 0) || !(height > 0)) continue;
            final double left = rect.optDouble("x", 0) * stage.density + stage.pageLeft;
            final double top = rect.optDouble("y", 0) * stage.density + stage.pageTop;
            // Whole pixels, rounded outwards: the two parts of the picture meet
            // on the same pixel edge, so no seam shows between them.
            final int at = earlyCount * 4;
            earlyRects[at] = (float) Math.floor(left);
            earlyRects[at + 1] = (float) Math.floor(top);
            earlyRects[at + 2] = (float) Math.ceil(left + width * stage.density);
            earlyRects[at + 3] = (float) Math.ceil(top + height * stage.density);
            earlyCount++;
        }
    }

    @Override
    void apply(WebView web, float pose) {
        poseFields(pose);
        // The live page stays where it is unless asked (see THE LIVE PAGE DOES NOT MOVE).
        if (liveScale == 1f) return;
        final float scale = liveScale + (1f - liveScale) * pose;
        web.setScaleX(scale);
        web.setScaleY(scale);
        // Scaling about the view's centre, shifted so it is the window's
        // centre that stays put: t = (1 - scale)(window centre - view centre).
        web.setTranslationX((1f - scale) * offsetX);
        web.setTranslationY((1f - scale) * offsetY);
    }

    /** The picture's scale and opacities for `pose`. */
    private void poseFields(float pose) {
        final float progress = opening ? pose : 1f - pose;
        pictureScale = 1f + (pictureEndScale - 1f) * progress;
        pictureAlpha = dissolve(progress, fadeEnd);
        earlyAlpha = opening ? 0f : dissolve(progress, earlyFadeEnd);
    }

    /** 1 at progress 0, 0 from `end` on, eased at both ends (a smoothstep). */
    private static float dissolve(float progress, float end) {
        final float t = Math.max(0f, Math.min(1f, progress / end));
        return 1f - t * t * (3f - 2f * t);
    }

    @Override
    void draw(Canvas canvas, Bitmap b, int width, int height) {
        final int pageAlpha = Math.round(255f * pictureAlpha);
        final boolean split = earlyCount > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
        final int rectAlpha = split ? Math.round(255f * earlyAlpha) : 0;
        if (pageAlpha <= 0 && rectAlpha <= 0) return;

        final int save = canvas.save();
        if (pictureScale != 1f) canvas.scale(pictureScale, pictureScale, width / 2f, height / 2f);
        if (!split) {
            drawPicture(canvas, b, pageAlpha);
        } else {
            if (pageAlpha > 0) {
                // The page, without the early elements' rectangles.
                final int inner = canvas.save();
                clipOutEarlyRects(canvas);
                drawPicture(canvas, b, pageAlpha);
                canvas.restoreToCount(inner);
            }
            if (rectAlpha > 0) {
                // The rectangles, dissolving on their own.
                for (int i = 0; i < earlyCount; i++) {
                    final int at = i * 4;
                    final int inner = canvas.save();
                    canvas.clipRect(earlyRects[at], earlyRects[at + 1], earlyRects[at + 2], earlyRects[at + 3]);
                    drawPicture(canvas, b, rectAlpha);
                    canvas.restoreToCount(inner);
                }
            }
        }
        canvas.restoreToCount(save);
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private void clipOutEarlyRects(Canvas canvas) {
        for (int i = 0; i < earlyCount; i++) {
            final int at = i * 4;
            canvas.clipOutRect(earlyRects[at], earlyRects[at + 1], earlyRects[at + 2], earlyRects[at + 3]);
        }
    }

    private void drawPicture(Canvas canvas, Bitmap b, int alpha) {
        bitmapPaint.setAlpha(alpha);
        canvas.drawBitmap(b, 0f, 0f, bitmapPaint);
    }
}
