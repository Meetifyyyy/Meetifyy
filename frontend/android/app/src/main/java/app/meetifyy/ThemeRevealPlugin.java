package app.meetifyy;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Region;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Choreographer;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import android.view.animation.LinearInterpolator;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/**
 * The theme switch's circular reveal, drawn natively.
 *
 * WHY NOT THE WEB VERSION
 * The page used to do this with a View Transition: a clip-path circle on
 * ::view-transition-new(root). Measured on a device (Chrome 154 WebView,
 * 60 Hz) that is GPU-bound — Chrome rasterises a full-screen PaintWorklet mask
 * every frame, so the reveal ran at ~48 fps with one frame in five dropped,
 * after a 180-250 ms frozen capture phase before anything moved. None of that
 * is the page's work; it is the cost of doing a full-screen animated mask
 * inside the renderer.
 *
 * WHAT THIS DOES INSTEAD
 * 1. `begin` screenshots the window (PixelCopy) and draws the screenshot over
 *    everything, so the screen looks unchanged.
 * 2. The page switches its theme underneath, invisibly.
 * 3. `reveal` waits until the WebView has the new theme ready to draw, then
 *    grows a transparent circular HOLE in the screenshot. Through the hole is
 *    the live WebView in the new theme — the same picture as the web version
 *    (a circle of the new theme growing from the tap), but the per-frame work
 *    is one textured quad with an analytic circle clip, which the GPU does in
 *    well under a millisecond, and the page's main thread does nothing at all.
 *
 * THE OVERLAY IS A DRAWABLE IN THE DECOR VIEW'S ViewOverlay, NOT A CHILD VIEW
 * Adding a child to the decor view requests a layout of the whole hierarchy
 * and (a FrameLayout child with insets listeners in play) an insets dispatch —
 * exactly what this must never cause mid-switch: SystemUiPlugin's insets
 * listener republishes the bar heights to the page, and the WebView would be
 * measured again. A child would also be laid out INSIDE the decor's padding,
 * which holds the side insets in landscape, so the screenshot would be drawn
 * inset from the screenshot's own pixels. A ViewOverlay drawable is drawn on
 * top of every child, over the host's full bounds, with no layout, no insets
 * and no touch handling of any kind (overlay drawables never receive events),
 * so taps go straight to the WebView beneath — the user can tap the toggle
 * again mid-reveal.
 *
 * THE HOLE IS A CLIP, NOT AN EVEN-ODD PATH
 * Drawing "full rect + circle" as an even-odd path is a general non-convex
 * path, which the GPU renderer may rasterise into a coverage mask on the CPU
 * — a full-screen mask every frame, the same cost this replaces. Clipping the
 * circle OUT (clipOutPath) and drawing the bitmap is recognised by Skia as an
 * oval clip and done analytically in the fragment shader, antialiased (HWUI
 * clips with AA). Android 8.0/8.1 still render with the older OpenGL pipeline,
 * where the edge is a stencil clip and not antialiased; it is a 1 px edge on
 * a moving circle.
 *
 * BAR ICONS
 * The bars' backgrounds are page pixels (inside the screenshot and the
 * WebView), so the hole reveals them like everything else. Their ICONS are
 * drawn by SystemUI, light or dark, nothing in between, and SystemUI fades the
 * tint over ~120 ms. While the overlay is up this plugin holds the icons
 * (SystemUiHelper.holdIcons): the page's SystemUi.setIcons requests are
 * remembered as the TARGET, and each bar keeps the OLD icons until the circle
 * reaches its centre, then flips to the target, 60 ms early so the 120 ms fade
 * is centred on the moment the edge passes. Both directions: reverse() puts
 * each bar back as the edge recedes past it.
 *
 * JS CONTRACT (all methods run their view work on the UI thread):
 *   begin({x, y})                  -> {}   overlay on screen; or rejects with code
 *                                          "unsupported" (API < 26, capture failed,
 *                                          not laid out), "active" (already up),
 *                                          "cancelled" (torn down before it drew)
 *   reveal({x, y, radius, duration=800}) CSS px / ms
 *                                  -> {state: "open"}    hole reached radius; overlay gone
 *                                  -> {state: "closed"}  reversed back to 0; overlay KEPT
 *                                  -> {state: "open", interrupted: true}  torn down mid-way
 *                                     (pause, finish(), watchdog); overlay gone
 *                                     rejects "idle" (no overlay), "running" (one already)
 *   reverse()                      -> {} flipped, or {state: "idle"} if nothing to flip
 *   finish()                       -> {} after the WebView painted and the overlay is gone
 */
@CapacitorPlugin(name = "ThemeReveal")
public class ThemeRevealPlugin extends Plugin implements SystemUiHelper.IconHold {

    private static final long DEFAULT_DURATION_MS = 800L;
    /**
     * SystemUI fades an icon tint change over ~120 ms; starting it this much
     * before the circle's edge reaches the bar's centre puts the middle of the
     * fade on the crossing.
     */
    private static final long ICON_LEAD_MS = 60L;
    /** The screenshot is kept this long after use, so a quick second toggle reuses it. */
    private static final long BITMAP_RELEASE_MS = 3000L;
    /**
     * Nothing may leave the screen frozen behind a screenshot. An overlay that
     * has no running animation, no pending finish() and no progress for this
     * long (a lost call, a page that died between begin and reveal) is removed.
     */
    private static final long WATCHDOG_MS = 3000L;
    /**
     * finish() waits for the WebView to report the reverted page ready to draw.
     * A WebView that is not drawing (hidden, renderer gone) never reports;
     * after this the overlay is removed anyway.
     */
    private static final long FINISH_FALLBACK_MS = 500L;

    private final Handler main = new Handler(Looper.getMainLooper());

    // ── State. UI thread only. ─────────────────────────────────────────────

    /** Bumped by every teardown: callbacks carrying an older value are stale and ignored. */
    private int generation = 0;
    private boolean capturing = false;
    private boolean attached = false;
    private boolean finishing = false;
    /** reveal() is waiting for the WebView's visual-state callback before animating. */
    private boolean revealWaiting = false;
    /** reverse() arrived while revealWaiting: the reveal is cancelled before it moves. */
    private boolean flipBeforeStart = false;
    /** The animator is playing toward maxRadius (false after an odd number of reverse()). */
    private boolean forward = true;
    /** Set while this plugin cancels its own animator, so the end listener ignores it. */
    private boolean silencing = false;

    private PluginCall beginCall;
    private PluginCall revealCall;
    private final ArrayList<PluginCall> finishCalls = new ArrayList<>();

    private Bitmap bitmap;
    private RevealDrawable drawable;
    private View host;
    private ValueAnimator animator;
    private long visualStateRequestId = 0;

    // Reveal geometry, device px in the host's (decor's) coordinates.
    private float maxRadius = 0f;
    private float lead = 0f;
    private float statusCross = Float.MAX_VALUE;
    private float navCross = Float.MAX_VALUE;

    // Icons: what was on screen at begin(), which bars show the target, what was last applied.
    private boolean oldStatusLight = false;
    private boolean oldNavLight = false;
    private boolean statusShowsTarget = false;
    private boolean navShowsTarget = false;
    private boolean appliedStatusLight = false;
    private boolean appliedNavLight = false;

    // Allocated once, so nothing per frame or per call creates a closure.
    private final Runnable watchdog = this::onWatchdog;
    private final Runnable finishFallback = this::onFinishFallback;
    private final Runnable releaseBitmap = this::onReleaseBitmap;
    private final Choreographer.FrameCallback firstFrameShown = frameTimeNanos -> onOverlayShown();
    private final View.OnLayoutChangeListener hostResized =
        (v, l, t, r, b, ol, ot, or, ob) -> {
            // Rotation, split screen, a fold: the screenshot no longer matches
            // the window. Removing it shows the page as it is, which is the
            // new theme, already laid out for the new size.
            if (attached && (r - l != or - ol || b - t != ob - ot)) tearDown();
        };

    // ── begin ──────────────────────────────────────────────────────────────

    /**
     * Freezes the screen: screenshot, then the screenshot drawn over the WebView.
     * Resolves once the overlay has been drawn and the frame after it has begun,
     * so whatever the page changes after this resolves is underneath it.
     *
     * @param call `x`, `y`: the reveal's origin in CSS px (informational; reveal() takes them again)
     */
    @PluginMethod
    public void begin(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity", "unsupported");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // PixelCopy of a window is API 26. The page falls back to its own reveal.
            call.reject("PixelCopy needs API 26", "unsupported");
            return;
        }
        activity.runOnUiThread(() -> beginOnUi(activity, call));
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private void beginOnUi(Activity activity, PluginCall call) {
        if (capturing || attached) {
            call.reject("a reveal is already on screen", "active");
            return;
        }
        if (activity.isFinishing()) {
            call.reject("activity finishing", "unsupported");
            return;
        }
        final Window window = activity.getWindow();
        final View decor = window == null ? null : window.getDecorView();
        if (decor == null || decor.getWidth() <= 0 || decor.getHeight() <= 0 || !decor.isAttachedToWindow()) {
            call.reject("window not laid out", "unsupported");
            return;
        }
        final int width = decor.getWidth();
        final int height = decor.getHeight();

        // Reused while the size matches: a full-screen ARGB_8888 bitmap is ~10 MB,
        // and allocating one per toggle is both a stall and a GC.
        main.removeCallbacks(releaseBitmap);
        if (bitmap == null || bitmap.isRecycled() || bitmap.getWidth() != width || bitmap.getHeight() != height) {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            bitmap = null;
            try {
                bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            } catch (OutOfMemoryError | IllegalArgumentException e) {
                call.reject("no memory for the screenshot", "unsupported");
                return;
            }
        }

        capturing = true;
        beginCall = call;
        final int gen = generation;
        // A copy that never calls back must not leave `capturing` set forever.
        armWatchdog();
        try {
            // The window's last rendered frame: exactly what is on screen now,
            // bars' page-painted backgrounds included (their icons are SystemUI's
            // own window and are not in it, which is what we want).
            PixelCopy.request(window, bitmap, result -> onCaptured(gen, result), main);
        } catch (IllegalArgumentException e) {
            // No surface yet (or any longer).
            capturing = false;
            beginCall = null;
            main.removeCallbacks(watchdog);
            scheduleBitmapRelease();
            call.reject("capture failed: " + e.getMessage(), "unsupported");
        }
    }

    private void onCaptured(int gen, int result) {
        if (gen != generation) return; // torn down meanwhile; begin was already rejected
        capturing = false;
        final PluginCall call = beginCall;
        final Activity activity = getActivity();
        if (result != PixelCopy.SUCCESS || activity == null || activity.isFinishing()
            || activity.getWindow() == null) {
            beginCall = null;
            main.removeCallbacks(watchdog);
            scheduleBitmapRelease();
            if (call != null) call.reject("capture failed (" + result + ")", "unsupported");
            return;
        }
        final View decor = activity.getWindow().getDecorView();
        if (decor.getWidth() != bitmap.getWidth() || decor.getHeight() != bitmap.getHeight()) {
            // Resized between the request and the copy.
            beginCall = null;
            main.removeCallbacks(watchdog);
            scheduleBitmapRelease();
            if (call != null) call.reject("window resized during capture", "unsupported");
            return;
        }

        // The icons on screen now are the OLD ones: the page has not switched yet.
        oldStatusLight = SystemUiHelper.statusLightIconsApplied(activity);
        oldNavLight = SystemUiHelper.navLightIconsApplied(activity);
        appliedStatusLight = oldStatusLight;
        appliedNavLight = oldNavLight;
        statusShowsTarget = false;
        navShowsTarget = false;
        // No reveal yet: neither bar can be crossed.
        statusCross = Float.MAX_VALUE;
        navCross = Float.MAX_VALUE;
        SystemUiHelper.holdIcons(this);

        // Start the texture upload now rather than on the first frame that draws it.
        bitmap.prepareToDraw();
        if (drawable == null) drawable = new RevealDrawable(this::onOverlayDrawn);
        drawable.bitmap = bitmap;
        drawable.radius = 0f;
        drawable.awaitingFirstDraw = true;
        drawable.setBounds(0, 0, decor.getWidth(), decor.getHeight());

        host = decor;
        attached = true;
        forward = true;
        decor.getOverlay().add(drawable);
        decor.addOnLayoutChangeListener(hostResized);
        drawable.invalidateSelf();
        armWatchdog();
    }

    /** The overlay's first draw has been recorded. Resolve once that frame is on its way. */
    private void onOverlayDrawn() {
        // Posted to the NEXT frame: by the time it runs, the frame with the
        // overlay has been handed to the RenderThread, and every later frame
        // (the only ones the page's change can appear in) contains it too.
        Choreographer.getInstance().postFrameCallback(firstFrameShown);
    }

    private void onOverlayShown() {
        if (!attached || beginCall == null) return;
        final PluginCall call = beginCall;
        beginCall = null;
        armWatchdog();
        call.resolve();
    }

    // ── reveal ─────────────────────────────────────────────────────────────

    /**
     * Grows the hole once the WebView has the page's new state ready to draw.
     *
     * @param call `x`, `y`: origin, CSS px in the WebView's viewport;
     *             `radius`: final radius, CSS px (the page passes the distance
     *             to the farthest corner — anything smaller leaves a ring of
     *             screenshot that vanishes at once when the overlay is removed);
     *             `duration`: ms, default 800, linear
     */
    @PluginMethod
    public void reveal(PluginCall call) {
        final Double x = call.getDouble("x");
        final Double y = call.getDouble("y");
        final Double radius = call.getDouble("radius");
        final Double durationValue = call.getDouble("duration");
        if (x == null || y == null || radius == null
            || x.isNaN() || y.isNaN() || radius.isNaN() || radius.isInfinite() || radius < 0) {
            call.reject("x, y and a finite radius >= 0 are required", "invalid");
            return;
        }
        final long duration = durationValue == null || durationValue.isNaN() || durationValue < 0
            ? DEFAULT_DURATION_MS
            : Math.round(durationValue);
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity", "idle");
            return;
        }
        activity.runOnUiThread(() -> revealOnUi(call, x.floatValue(), y.floatValue(), radius.floatValue(), duration));
    }

    private void revealOnUi(PluginCall call, float x, float y, float radiusCss, long duration) {
        if (!attached || beginCall != null || finishing) {
            call.reject("no overlay to reveal (call begin() first)", "idle");
            return;
        }
        if (revealCall != null) {
            call.reject("a reveal is already running", "running");
            return;
        }
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;

        // CSS px -> device px. The WebView's CSS px are its density-independent
        // pixels (the app sets no page zoom), and its viewport's (0,0) is the
        // WebView's top-left, which is offset from the overlay's host by the
        // decor's side padding in landscape.
        final float density = webView != null
            ? webView.getResources().getDisplayMetrics().density
            : host.getResources().getDisplayMetrics().density;
        float offsetX = 0f;
        float offsetY = 0f;
        if (webView != null) {
            final int[] web = new int[2];
            final int[] hostLoc = new int[2];
            webView.getLocationInWindow(web);
            host.getLocationInWindow(hostLoc);
            offsetX = web[0] - hostLoc[0];
            offsetY = web[1] - hostLoc[1];
        }
        final float cx = offsetX + x * density;
        final float cy = offsetY + y * density;
        maxRadius = radiusCss * density;
        drawable.cx = cx;
        drawable.cy = cy;

        // Where each bar is crossed: the distance from the origin to the bar's
        // centre. The ROOT insets, not the ones the WebView sees (SystemUiPlugin
        // zeroes those for its children).
        final int w = host.getWidth();
        final int h = host.getHeight();
        final WindowInsetsCompat rootInsets = ViewCompat.getRootWindowInsets(host);
        final Insets bars = rootInsets != null
            ? rootInsets.getInsets(WindowInsetsCompat.Type.systemBars())
            : Insets.NONE;
        statusCross = distance(cx, cy, w / 2f, bars.top / 2f);
        if (bars.bottom > 0) {
            navCross = distance(cx, cy, w / 2f, h - bars.bottom / 2f);
        } else if (bars.right > 0) {
            // Landscape 3-button navigation sits on a side.
            navCross = distance(cx, cy, w - bars.right / 2f, h / 2f);
        } else if (bars.left > 0) {
            navCross = distance(cx, cy, bars.left / 2f, h / 2f);
        } else {
            navCross = distance(cx, cy, w / 2f, h);
        }
        // Linear: the radius covered in ICON_LEAD_MS.
        lead = duration > 0 ? maxRadius * ICON_LEAD_MS / duration : 0f;

        revealCall = call;
        forward = true;
        flipBeforeStart = false;
        revealWaiting = true;
        armWatchdog();

        final int gen = generation;
        if (webView == null) {
            startAnimation(gen, duration);
            return;
        }
        // The page changed its DOM after begin() resolved. Animating before the
        // WebView can draw that change would open the hole onto the OLD theme
        // for a frame or more. This fires (on the UI thread) when the next draw
        // of the WebView will show everything the page did before this call.
        final long requestId = ++visualStateRequestId;
        webView.postVisualStateCallback(requestId, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long id) {
                if (id == requestId) startAnimation(gen, duration);
            }
        });
    }

    /** See the update listener in startAnimation. */
    private boolean firstAnimationFrame = false;
    private static final long FRAME_MS = 16;
    private static final long FIRST_FRAME_SLACK_MS = 24;

    private void startAnimation(int gen, long duration) {
        if (gen != generation || !revealWaiting || !attached) return;
        revealWaiting = false;
        if (flipBeforeStart) {
            // Reversed before it moved: it is already "closed" (radius 0, overlay up).
            flipBeforeStart = false;
            forward = false;
            onReachedClosed();
            return;
        }
        if (animator == null) {
            // One animator for the life of the plugin. It animates the FRACTION;
            // the radius is fraction * maxRadius, read with getAnimatedFraction()
            // so no Float is boxed per frame.
            animator = ValueAnimator.ofFloat(0f, 1f);
            animator.setInterpolator(new LinearInterpolator());
            animator.addUpdateListener(a -> {
                /*
                 * The first frame of the circle is also the first frame that
                 * draws the WebView in its new theme, which on the I2208 took
                 * long enough that the animator's clock had already run ~160ms:
                 * the circle appeared a fifth of the way out in one jump. Time
                 * starts at the frame the circle is first drawn instead.
                 */
                if (firstAnimationFrame) {
                    firstAnimationFrame = false;
                    if (a.getCurrentPlayTime() > FIRST_FRAME_SLACK_MS) {
                        a.setCurrentPlayTime(FRAME_MS);
                        return;
                    }
                }
                onFrame(a.getAnimatedFraction() * maxRadius);
            });
            animator.addListener(new AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(Animator a) {
                    if (silencing) return;
                    if (forward) onReachedOpen();
                    else onReachedClosed();
                }
            });
        }
        animator.setDuration(duration);
        forward = true;
        firstAnimationFrame = true;
        animator.start();
    }

    /** Per frame: no allocation, one invalidate, an icon call only when a bar flips. */
    private void onFrame(float radius) {
        if (!attached) return;
        drawable.radius = radius;
        drawable.invalidateSelf();
        updateIcons(radius);
    }

    private void onReachedOpen() {
        // The last update drew the hole at maxRadius, which (with the page's
        // radius) covers the whole screen, so removing the overlay in this same
        // frame changes no pixel: no flash.
        if (!attached) return;
        updateIcons(maxRadius);
        final PluginCall call = revealCall;
        revealCall = null;
        tearDown();
        if (call != null) call.resolve(state("open", false));
    }

    private void onReachedClosed() {
        // Fully covered again, overlay KEPT: the page now puts its DOM back and
        // calls finish(), which removes the overlay once that has painted.
        if (!attached) return;
        drawable.radius = 0f;
        drawable.invalidateSelf();
        updateIcons(0f);
        final PluginCall call = revealCall;
        revealCall = null;
        armWatchdog();
        if (call != null) call.resolve(state("closed", false));
    }

    // ── reverse ────────────────────────────────────────────────────────────

    /** Plays the running reveal backwards from where it is; again to flip back. */
    @PluginMethod
    public void reverse(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve(state("idle", false));
            return;
        }
        activity.runOnUiThread(() -> {
            if (revealWaiting) {
                // Not moving yet; honoured when it would have started.
                flipBeforeStart = !flipBeforeStart;
                call.resolve();
                return;
            }
            if (attached && revealCall != null && animator != null && animator.isRunning()) {
                forward = !forward;
                // From the current fraction, over the time already played: the
                // edge retraces its path at the same speed.
                animator.reverse();
                call.resolve();
                return;
            }
            call.resolve(state("idle", false));
        });
    }

    // ── finish ─────────────────────────────────────────────────────────────

    /**
     * Removes the overlay once the WebView has painted what the page just did.
     * Safe to call at any time; with nothing on screen it resolves at once.
     */
    @PluginMethod
    public void finish(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> finishOnUi(call));
    }

    private void finishOnUi(PluginCall call) {
        if (!attached && !capturing) {
            call.resolve();
            return;
        }
        if (!attached) {
            // Still capturing: nothing on screen to wait for.
            tearDown();
            call.resolve();
            return;
        }
        finishCalls.add(call);
        if (finishing) return;
        finishing = true;

        // finish() during an animation or before begin() resolved ends them:
        // the screen will show the page as it now is.
        stopAnimatorSilently();
        revealWaiting = false;
        if (revealCall != null) {
            final PluginCall pending = revealCall;
            revealCall = null;
            pending.resolve(state("open", true));
        }
        if (beginCall != null) {
            final PluginCall pending = beginCall;
            beginCall = null;
            pending.reject("finished before the overlay was shown", "cancelled");
        }

        main.removeCallbacks(watchdog);
        main.postDelayed(finishFallback, FINISH_FALLBACK_MS);
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            tearDown();
            return;
        }
        final int gen = generation;
        final long requestId = ++visualStateRequestId;
        webView.postVisualStateCallback(requestId, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long id) {
                if (id == requestId && gen == generation && finishing) tearDown();
            }
        });
    }

    private void onFinishFallback() {
        if (finishing) tearDown();
    }

    // ── Icons ──────────────────────────────────────────────────────────────

    /** Flips a bar between old and target icons as the edge crosses its centre. */
    private void updateIcons(float radius) {
        final boolean status = radius >= statusCross - lead;
        final boolean nav = radius >= navCross - lead;
        if (status == statusShowsTarget && nav == navShowsTarget) return;
        statusShowsTarget = status;
        navShowsTarget = nav;
        applyIcons(false);
    }

    /**
     * Applies, per bar, the target (the page's latest request) or the old
     * icons. Only when something differs from what was last applied: each
     * call is a window-attributes change and a traversal.
     */
    private void applyIcons(boolean force) {
        final Activity activity = getActivity();
        if (activity == null) return;
        final Boolean pageStatus = SystemUiHelper.pageStatusLightIcons();
        final Boolean pageNav = SystemUiHelper.pageNavLightIcons();
        final boolean statusLight = (statusShowsTarget && pageStatus != null) ? pageStatus : oldStatusLight;
        final boolean navLight = (navShowsTarget && pageNav != null) ? pageNav : oldNavLight;
        if (!force && statusLight == appliedStatusLight && navLight == appliedNavLight) return;
        appliedStatusLight = statusLight;
        appliedNavLight = navLight;
        SystemUiHelper.setBarIcons(activity, statusLight, navLight);
    }

    /** SystemUiHelper.IconHold: the page asked for icons, or the system reset them. */
    @Override
    public void onPageIconsChanged(boolean force) {
        applyIcons(force);
    }

    // ── Teardown and safety ────────────────────────────────────────────────

    /**
     * The one way an overlay leaves the screen. Ends the animation, removes the
     * overlay, settles every pending call, releases the icon hold (which applies
     * the page's latest icons) and schedules the screenshot's release.
     * Idempotent.
     */
    private void tearDown() {
        generation++;
        main.removeCallbacks(watchdog);
        main.removeCallbacks(finishFallback);
        Choreographer.getInstance().removeFrameCallback(firstFrameShown);
        stopAnimatorSilently();
        revealWaiting = false;
        flipBeforeStart = false;
        capturing = false;

        if (attached) {
            attached = false;
            if (host != null) {
                host.removeOnLayoutChangeListener(hostResized);
                host.getOverlay().remove(drawable);
            }
            if (drawable != null) drawable.bitmap = null;
        }
        host = null;
        statusCross = Float.MAX_VALUE;
        navCross = Float.MAX_VALUE;

        if (beginCall != null) {
            final PluginCall pending = beginCall;
            beginCall = null;
            pending.reject("reveal torn down before the overlay was shown", "cancelled");
        }
        if (revealCall != null) {
            // The overlay is gone, so what is on screen is the page as it is now.
            final PluginCall pending = revealCall;
            revealCall = null;
            pending.resolve(state("open", true));
        }
        finishing = false;
        if (!finishCalls.isEmpty()) {
            for (int i = 0; i < finishCalls.size(); i++) finishCalls.get(i).resolve();
            finishCalls.clear();
        }

        SystemUiHelper.releaseIcons(getActivity(), this);
        scheduleBitmapRelease();
    }

    private void stopAnimatorSilently() {
        if (animator == null || !animator.isStarted()) return;
        silencing = true;
        try {
            animator.cancel();
        } finally {
            silencing = false;
        }
    }

    private void armWatchdog() {
        main.removeCallbacks(watchdog);
        main.postDelayed(watchdog, WATCHDOG_MS);
    }

    private void onWatchdog() {
        if (!attached && !capturing) return;
        if (animator != null && animator.isRunning()) {
            // Moving is progress; check again after it.
            armWatchdog();
            return;
        }
        // finish() has its own, shorter fallback, so anything still here is stuck.
        tearDown();
    }

    private void scheduleBitmapRelease() {
        main.removeCallbacks(releaseBitmap);
        main.postDelayed(releaseBitmap, BITMAP_RELEASE_MS);
    }

    private void onReleaseBitmap() {
        // Long after the last frame that drew it, so the RenderThread is done with it.
        if (attached || capturing || bitmap == null) return;
        bitmap.recycle();
        bitmap = null;
    }

    /*
     * The activity leaving the screen ends any reveal: the overlay must never be
     * what the user comes back to, and the animator would be paused mid-way by
     * the system anyway. The page sees the reveal resolve {state:"open",
     * interrupted:true} and the DOM as it is.
     */
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (attached || capturing) tearDown();
    }

    @Override
    protected void handleOnDestroy() {
        tearDown();
        main.removeCallbacksAndMessages(null);
        if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        bitmap = null;
        if (animator != null) {
            animator.removeAllUpdateListeners();
            animator.removeAllListeners();
            animator = null;
        }
        super.handleOnDestroy();
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private static float distance(float x1, float y1, float x2, float y2) {
        final float dx = x2 - x1;
        final float dy = y2 - y1;
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    private static JSObject state(String state, boolean interrupted) {
        final JSObject result = new JSObject();
        result.put("state", state);
        if (interrupted) result.put("interrupted", true);
        return result;
    }

    /**
     * The screenshot with a circular hole. Everything it uses per frame is a
     * field: the Path is rewound, not reallocated.
     */
    private static final class RevealDrawable extends Drawable {
        private final Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
        private final Path hole = new Path();
        private final RectF dst = new RectF();
        private final Runnable onFirstDraw;

        Bitmap bitmap;
        float cx;
        float cy;
        float radius;
        boolean awaitingFirstDraw;

        RevealDrawable(Runnable onFirstDraw) {
            this.onFirstDraw = onFirstDraw;
        }

        @Override
        public void draw(@NonNull Canvas canvas) {
            final Bitmap b = bitmap;
            if (b == null || b.isRecycled()) return;
            dst.set(getBounds());
            final int save = canvas.save();
            if (radius > 0f) {
                hole.rewind();
                hole.addCircle(cx, cy, radius, Path.Direction.CW);
                // An oval path: clipped analytically and antialiased (see the class comment).
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    canvas.clipOutPath(hole);
                } else {
                    canvas.clipPath(hole, Region.Op.DIFFERENCE);
                }
            }
            canvas.drawBitmap(b, null, dst, paint);
            canvas.restoreToCount(save);
            if (awaitingFirstDraw) {
                awaitingFirstDraw = false;
                onFirstDraw.run();
            }
        }

        @Override
        public void setAlpha(int alpha) {
            paint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(ColorFilter colorFilter) {
            paint.setColorFilter(colorFilter);
        }

        @Override
        @SuppressWarnings("deprecation")
        public int getOpacity() {
            return PixelFormat.TRANSLUCENT;
        }
    }
}
