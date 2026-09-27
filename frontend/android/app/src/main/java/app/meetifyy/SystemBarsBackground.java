package app.meetifyy;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;

/**
 * The window background, in two bands: the status bar's colour across the top
 * strip, the navigation bar's colour everywhere else.
 *
 * The app runs edge to edge (Capacitor's SystemBars), so the system bars are
 * transparent and what shows through them is the window's background, not
 * `setStatusBarColor`/`setNavigationBarColor` — measured on a device: both bars
 * showed the window colour whatever those calls were given. One flat window
 * colour therefore meant one colour for both bars; this lets each bar continue
 * the page edge it meets. The area between the bands is covered by the WebView.
 */
final class SystemBarsBackground extends Drawable {
    private final Paint statusPaint = new Paint();
    private final Paint navPaint = new Paint();
    private final int statusBarHeight;

    SystemBarsBackground(int statusColor, int navColor, int statusBarHeight) {
        statusPaint.setColor(statusColor);
        navPaint.setColor(navColor);
        this.statusBarHeight = statusBarHeight;
    }

    @Override
    public void draw(Canvas canvas) {
        final Rect b = getBounds();
        canvas.drawRect(b, navPaint);
        canvas.drawRect(b.left, b.top, b.right, b.top + statusBarHeight, statusPaint);
    }

    @Override public void setAlpha(int alpha) {}
    @Override public void setColorFilter(ColorFilter colorFilter) {}
    @Override public int getOpacity() { return PixelFormat.OPAQUE; }
}
