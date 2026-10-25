package app.meetifyy;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Choreographer;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import android.view.animation.PathInterpolator;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/**
 * A page opening over the one beneath it, and closing back onto it, drawn by
 * the shell.
 *
 * THE EFFECTS
 * What the motion looks like is a PageEffect, chosen per play by `effect`:
 *   "slide"   SlidePageEffect    the new page slides in from the right edge
 *                                over the current one, which drifts left and
 *                                dims, with a shadow along the leading edge
 *   "centre"  CentrePageEffect   the new page opens out of the middle of the
 *                                screen, scaling down to size as it fades in,
 *                                while the page beneath shrinks away
 * Closing is the same motion played the other way. This class is everything the
 * effects share: the screenshot, the one animator, turning round, the bars'
 * icons and teardown.
 *
 * WHY THE SHELL DRAWS IT
 * The WebView holds one page at a time: the moment the route changes, the page
 * being left no longer exists, so something has to keep a picture of it. A
 * View Transition would, but on the I2208 capturing its snapshots froze the
 * screen for 180-250 ms before anything moved, and the page cannot hit-test
 * while one runs, so the bars could not be sampled (see ThemeRevealPlugin).
 *
 * WHAT HAPPENS INSTEAD
 * 1. `begin` screenshots the window (PixelCopy) and draws the picture over
 *    everything. The screen looks exactly as it did.
 * 2. The page navigates underneath, out of sight.
 * 3. `play` waits until the WebView has the new page ready to draw, then moves
 *    two things together, every frame, from one animator on the UI thread:
 *    the WebView itself (a view transform: no layout, no re-raster, nothing
 *    for the page's main thread to do), and the screenshot, drawn as the other
 *    page. The page the user is going TO is always the live WebView, so it
 *    keeps loading and painting while it moves; the page they are leaving is
 *    the screenshot.
 *
 *      open   WebView    = the top page
 *             screenshot = the page beneath
 *      close  screenshot = the top page
 *             WebView    = the page beneath
 *
 * Both are positioned from one number, `s`: how much of the screen the top
 * page has taken (0 = not there yet, 1 = covering it). Opening plays s 0 -> 1,
 * closing 1 -> 0.
 *
 * THE PICTURE IS A DRAWABLE IN THE DECOR VIEW'S ViewOverlay
 * For the reasons given in ThemeRevealPlugin: no layout, no insets dispatch,
 * drawn over every child across the full window, and never a touch target.
 *
 * BAR ICONS
 * The bars' backgrounds are page pixels and move with the pages. Their icons
 * are SystemUI's, one tint per bar, so they are held from the screenshot on
 * (SystemUiHelper.holdIcons) and switch to the new page's when it covers half
 * the screen, in both directions. Window colour changes the new page asks for
 * meanwhile are deferred to the end (SystemUiHelper.runWhenRevealEnds).
 *
 * JS CONTRACT (all view work runs on the UI thread):
 *   begin({effect: "slide"|"centre"})
 *             -> {}  picture on screen; or rejects with code
 *                    "unsupported" (API < 26, capture failed, not laid out),
 *                    "active" (already up), "cancelled" (torn down before it drew)
 *   play({effect: "slide"|"centre" (default "slide"),
 *         direction: "open"|"close", duration, curve: {x1, y1, x2, y2},
 *         ...the effect's own arguments (see its class)})
 *                    ms; cubic-bezier control points
 *             -> {state: "done"}       finished: picture gone, WebView in place
 *             -> {state: "reversed"}   turned round and back at the start: the
 *                                      picture covers the screen and is KEPT;
 *                                      the page puts its previous state back
 *                                      underneath and calls finish()
 *             -> {state: "done", interrupted: true}  torn down mid-way (pause,
 *                                      finish(), watchdog): the page as it is
 *                rejects "idle" (no picture), "running" (one already), "invalid" (unknown
 *                effect or direction)
 *   reverse() -> {}  turned round from where it is (again to turn back), or
 *                    {state: "idle"} if nothing is moving
 *   finish()  -> {}  once the WebView has painted the page as it now is, the
 *                    picture is gone and the WebView is back in place
 */
@CapacitorPlugin(name = "PageTransition")
public class PageTransitionPlugin extends Plugin implements SystemUiHelper.IconHold {

    /** Kept briefly after use, so the close that usually follows an open reuses it. */
    private static final long BITMAP_RELEASE_MS = 3000L;
    /** See ThemeRevealPlugin.WATCHDOG_MS: nothing may leave the screen frozen behind a picture. */
    private static final long WATCHDOG_MS = 3000L;
    /** finish() waits for the WebView's paint; a WebView that is not drawing never reports. */
    private static final long FINISH_FALLBACK_MS = 500L;
    /** A turn-round covers the distance already travelled at the same pace, but never quicker than this. */
    private static final long MIN_REVERSE_MS = 160L;
    private static final long MAX_DURATION_MS = 2000L;

    private final Handler main = new Handler(Looper.getMainLooper());

    // ── State. UI thread only. ─────────────────────────────────────────────

    /** Bumped by every teardown: callbacks carrying an older value are stale and ignored. */
    private int generation = 0;
    private boolean capturing = false;
    /** Whether this transition keeps the WebView's off-screen tiles rastered (begin's `effect`). */
    private boolean preRaster = true;
    private boolean attached = false;
    private boolean finishing = false;
    /** play() is waiting for the WebView's visual-state callback before moving. */
    private boolean playWaiting = false;
    /** reverse() arrived while playWaiting: the play ends "reversed" without moving. */
    private boolean reverseBeforeStart = false;
    /** Set while this plugin cancels its own animator, so the end listener ignores it. */
    private boolean silencing = false;

    private PluginCall beginCall;
    private PluginCall playCall;
    private final ArrayList<PluginCall> finishCalls = new ArrayList<>();

    private Bitmap bitmap;
    private PagesDrawable drawable;
    private View host;
    private WebView webView;
    private ValueAnimator animator;
    private long visualStateRequestId = 0;

    // One of each, made on first use and reused: an effect holds its paints.
    private SlidePageEffect slideEffect;
    private CentrePageEffect centreEffect;

    // The play in progress.
    private PageEffect effect;
    private boolean opening = true;
    private long playDuration = 0L;
    private float fromS = 0f;
    private float toS = 1f;
    /** Where the top page is now. */
    private float s = 0f;
    private PathInterpolator curve;

    // Icons: what was on screen at begin(), whether the bars show the new page's, what was last applied.
    private boolean oldStatusLight = false;
    private boolean oldNavLight = false;
    private boolean showsTarget = false;
    private boolean appliedStatusLight = false;
    private boolean appliedNavLight = false;

    /** See the update listener in startAnimation. */
    private boolean firstAnimationFrame = false;
    private static final long FRAME_MS = 16;
    private static final long FIRST_FRAME_SLACK_MS = 24;

    // Allocated once, so nothing per frame or per call creates a closure.
    private final Runnable watchdog = this::onWatchdog;
    private final Runnable finishFallback = this::onFinishFallback;
    private final Runnable releaseBitmap = this::onReleaseBitmap;
    private final Choreographer.FrameCallback firstFrameShown = frameTimeNanos -> onPictureShown();
    private final View.OnLayoutChangeListener hostResized =
        (v, l, t, r, b, ol, ot, or, ob) -> {
            // Rotation, split screen, a fold: the picture no longer matches the
            // window. Removing it shows the page as it is, laid out for the new size.
            if (attached && (r - l != or - ol || b - t != ob - ot)) tearDown();
        };

    // ── begin ──────────────────────────────────────────────────────────────

    /**
     * Freezes the screen: screenshot, then the screenshot drawn over the WebView.
     * Resolves once the picture has been drawn and the frame after it has begun,
     * so whatever the page changes after this resolves is underneath it.
     */
    @PluginMethod
    public void begin(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity", "unsupported");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // PixelCopy of a window is API 26. The page navigates without the motion.
            call.reject("PixelCopy needs API 26", "unsupported");
            return;
        }
        activity.runOnUiThread(() -> beginOnUi(activity, call));
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private void beginOnUi(Activity activity, PluginCall call) {
        // Only the slide moves the WebView off screen; see onCaptured.
        preRaster = !"centre".equals(call.getString("effect", "slide"));
        if (capturing || attached) {
            call.reject("a page transition is already on screen", "active");
            return;
        }
        if (activity.isFinishing()) {
            call.reject("activity finishing", "unsupported");
            return;
        }
        final Window window = activity.getWindow();
        final View decor = window == null ? null : window.getDecorView();
        final WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (decor == null || decor.getWidth() <= 0 || decor.getHeight() <= 0 || !decor.isAttachedToWindow()
            || web == null || web.getWidth() <= 0) {
            call.reject("window not laid out", "unsupported");
            return;
        }
        final int width = decor.getWidth();
        final int height = decor.getHeight();

        // Reused while the size matches: a full-screen ARGB_8888 bitmap is ~10 MB,
        // and allocating one per navigation is both a stall and a GC.
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
        armWatchdog();
        try {
            // The window's last rendered frame: exactly what is on screen now,
            // the bars' page-painted backgrounds included.
            PixelCopy.request(window, bitmap, result -> onCaptured(gen, result), main);
        } catch (IllegalArgumentException e) {
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
        final WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (result != PixelCopy.SUCCESS || activity == null || activity.isFinishing()
            || activity.getWindow() == null || web == null) {
            beginCall = null;
            main.removeCallbacks(watchdog);
            scheduleBitmapRelease();
            if (call != null) call.reject("capture failed (" + result + ")", "unsupported");
            return;
        }
        final View decor = activity.getWindow().getDecorView();
        if (decor.getWidth() != bitmap.getWidth() || decor.getHeight() != bitmap.getHeight()) {
            beginCall = null;
            main.removeCallbacks(watchdog);
            scheduleBitmapRelease();
            if (call != null) call.reject("window resized during capture", "unsupported");
            return;
        }

        // The icons on screen now are the leaving page's.
        oldStatusLight = SystemUiHelper.statusLightIconsApplied(activity);
        oldNavLight = SystemUiHelper.navLightIconsApplied(activity);
        appliedStatusLight = oldStatusLight;
        appliedNavLight = oldNavLight;
        showsTarget = false;
        SystemUiHelper.holdIcons(this);

        // Start the texture upload now rather than on the first frame that draws it.
        bitmap.prepareToDraw();
        if (drawable == null) drawable = new PagesDrawable(this::onPictureDrawn);
        drawable.bitmap = bitmap;
        drawable.playing = false;
        drawable.awaitingFirstDraw = true;
        drawable.setBounds(0, 0, decor.getWidth(), decor.getHeight());

        host = decor;
        webView = web;
        // While the WebView is moved partly or wholly off screen, Chromium
        // rasters only the part it thinks is visible: measured on the I2208,
        // the incoming page slid in as blank white tiles that filled in over
        // several frames. Pre-rastering keeps the whole viewport's tiles ready
        // for exactly as long as the transition lasts (WebSettings documents it
        // for animating a WebView on screen); tearDown turns it off again.
        // The centre opening leaves the WebView where it is, so it needs none,
        // and rastering tiles nobody sees would be work for the page being built.
        if (preRaster) web.getSettings().setOffscreenPreRaster(true);
        attached = true;
        decor.getOverlay().add(drawable);
        decor.addOnLayoutChangeListener(hostResized);
        drawable.invalidateSelf();
        armWatchdog();
    }

    /** The picture's first draw has been recorded. Resolve once that frame is on its way. */
    private void onPictureDrawn() {
        // Posted to the NEXT frame: by then the frame with the picture has been
        // handed to the RenderThread, and every later frame contains it too.
        Choreographer.getInstance().postFrameCallback(firstFrameShown);
    }

    private void onPictureShown() {
        if (!attached || beginCall == null) return;
        final PluginCall call = beginCall;
        beginCall = null;
        armWatchdog();
        call.resolve();
    }

    // ── play ───────────────────────────────────────────────────────────────

    @PluginMethod
    public void play(PluginCall call) {
        final String direction = call.getString("direction", "");
        if (!"open".equals(direction) && !"close".equals(direction)) {
            call.reject("direction must be \"open\" or \"close\"", "invalid");
            return;
        }
        final String effectName = call.getString("effect", "slide");
        if (!"slide".equals(effectName) && !"centre".equals(effectName)) {
            call.reject("effect must be \"slide\" or \"centre\"", "invalid");
            return;
        }
        final long duration = Math.round(PageEffect.clamp(PageEffect.number(call, "duration", 400), 0, MAX_DURATION_MS));
        final JSObject curveObject = call.getObject("curve", new JSObject());
        final float x1 = (float) PageEffect.clamp(curveObject.optDouble("x1", 0.32), 0, 1);
        final float y1 = (float) curveObject.optDouble("y1", 0.72);
        final float x2 = (float) PageEffect.clamp(curveObject.optDouble("x2", 0), 0, 1);
        final float y2 = (float) curveObject.optDouble("y2", 1);
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity", "idle");
            return;
        }
        activity.runOnUiThread(() -> playOnUi(call, effectName, "open".equals(direction), duration,
            x1, y1, x2, y2));
    }

    private PageEffect effectNamed(String name) {
        if ("centre".equals(name)) {
            if (centreEffect == null) centreEffect = new CentrePageEffect();
            return centreEffect;
        }
        if (slideEffect == null) slideEffect = new SlidePageEffect();
        return slideEffect;
    }

    private void playOnUi(PluginCall call, String effectName, boolean open, long duration,
                          float x1, float y1, float x2, float y2) {
        if (!attached || beginCall != null || finishing) {
            call.reject("no picture to move (call begin() first)", "idle");
            return;
        }
        if (playCall != null) {
            call.reject("a page transition is already playing", "running");
            return;
        }

        final int[] web = new int[2];
        final int[] hostLoc = new int[2];
        webView.getLocationInWindow(web);
        host.getLocationInWindow(hostLoc);
        // Measured with the WebView at rest; its own transform is ours and is none here.
        final PageEffect.Stage stage = new PageEffect.Stage(
            host.getWidth(), host.getHeight(),
            Math.round(web[0] - hostLoc[0] - webView.getTranslationX()),
            Math.round(web[1] - hostLoc[1] - webView.getTranslationY()),
            webView.getWidth(), webView.getHeight(),
            webView.getResources().getDisplayMetrics().density);
        opening = open;
        playDuration = duration;
        fromS = open ? 0f : 1f;
        toS = open ? 1f : 0f;
        s = fromS;
        try {
            curve = new PathInterpolator(x1, y1, x2, y2);
        } catch (IllegalArgumentException e) {
            curve = new PathInterpolator(0.32f, 0.72f, 0f, 1f);
        }

        effect = effectNamed(effectName);
        effect.configure(call, stage, open);
        drawable.start(effect);

        playCall = call;
        reverseBeforeStart = false;
        playWaiting = true;
        armWatchdog();

        // The page changed its DOM after begin() resolved. Moving before the
        // WebView can draw that change would slide the OLD page in. This fires
        // (on the UI thread) when the next draw of the WebView shows everything
        // the page did before this call.
        final int gen = generation;
        final long requestId = ++visualStateRequestId;
        webView.postVisualStateCallback(requestId, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long id) {
                if (id == requestId) startAnimation(gen);
            }
        });
    }

    private void startAnimation(int gen) {
        if (gen != generation || !playWaiting || !attached) return;
        playWaiting = false;
        if (reverseBeforeStart) {
            // Turned round before it moved: it is already back at the start, the
            // picture still covering the screen and the WebView never moved.
            reverseBeforeStart = false;
            onReachedStart();
            return;
        }
        // From here the picture is drawn as the pages, starting at the start
        // pose, which looks exactly like the plain screenshot did.
        applyPose(fromS);
        if (animator == null) {
            // One animator for the life of the plugin. It animates the FRACTION;
            // the pose is read from it with getAnimatedFraction(), so nothing is
            // boxed per frame.
            animator = ValueAnimator.ofFloat(0f, 1f);
            animator.addUpdateListener(a -> {
                /*
                 * As in ThemeRevealPlugin: if the first frame is late, the
                 * animator's clock has already run and the page would appear a
                 * good way in, in one jump. Time starts at the first frame drawn.
                 */
                if (firstAnimationFrame) {
                    firstAnimationFrame = false;
                    if (a.getCurrentPlayTime() > FIRST_FRAME_SLACK_MS) {
                        a.setCurrentPlayTime(FRAME_MS);
                        return;
                    }
                }
                applyPose(fromS + (toS - fromS) * a.getAnimatedFraction());
            });
            animator.addListener(new AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(Animator a) {
                    if (silencing) return;
                    if (toS == endS()) onReachedEnd();
                    else onReachedStart();
                }
            });
        }
        animator.setInterpolator(curve);
        animator.setDuration(playDuration);
        firstAnimationFrame = true;
        animator.start();
    }

    private float startS() {
        return opening ? 0f : 1f;
    }

    private float endS() {
        return opening ? 1f : 0f;
    }

    /**
     * Puts both pages where `pose` says, in this frame: the WebView by its view
     * transform, the picture by redrawing the overlay. No allocation.
     */
    private void applyPose(float pose) {
        if (!attached) return;
        s = pose;
        effect.apply(webView, pose);
        drawable.invalidateSelf();
        updateIcons();
    }

    private void onReachedEnd() {
        // The last frame drew the top page covering the screen (opening) or gone
        // (closing): the picture shows nothing the WebView does not, so removing
        // it in this frame changes no pixel.
        if (!attached) return;
        applyPose(endS());
        final PluginCall call = playCall;
        playCall = null;
        tearDown();
        if (call != null) call.resolve(state("done", false));
    }

    private void onReachedStart() {
        // Back where it started, picture KEPT: the page now puts its previous
        // state back underneath and calls finish().
        if (!attached) return;
        applyPose(startS());
        final PluginCall call = playCall;
        playCall = null;
        armWatchdog();
        if (call != null) call.resolve(state("reversed", false));
    }

    // ── reverse ────────────────────────────────────────────────────────────

    /** Turns the moving page round from where it is; again to turn it back. */
    @PluginMethod
    public void reverse(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve(state("idle", false));
            return;
        }
        activity.runOnUiThread(() -> {
            if (playWaiting) {
                // Not moving yet; honoured when it would have started.
                reverseBeforeStart = !reverseBeforeStart;
                call.resolve();
                return;
            }
            if (attached && playCall != null && animator != null && animator.isRunning()) {
                retarget(toS == endS() ? startS() : endS());
                call.resolve();
                return;
            }
            call.resolve(state("idle", false));
        });
    }

    /**
     * A new run from where the page is to `target`, on the same curve, over the
     * share of the duration that distance is: a page that had barely started
     * comes back at once, one nearly there takes the whole way.
     */
    private void retarget(float target) {
        stopAnimatorSilently();
        fromS = s;
        toS = target;
        final long duration = Math.max(MIN_REVERSE_MS, Math.round(playDuration * Math.abs(target - s)));
        animator.setDuration(duration);
        firstAnimationFrame = false;
        animator.start();
    }

    // ── finish ─────────────────────────────────────────────────────────────

    /**
     * Removes the picture and puts the WebView back in place once the WebView
     * has painted what the page just did. Safe to call at any time; with
     * nothing on screen it resolves at once.
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

        // finish() during a play ends it: the screen will show the page as it now is.
        stopAnimatorSilently();
        playWaiting = false;
        if (playCall != null) {
            final PluginCall pending = playCall;
            playCall = null;
            pending.resolve(state("done", true));
        }
        if (beginCall != null) {
            final PluginCall pending = beginCall;
            beginCall = null;
            pending.reject("finished before the picture was shown", "cancelled");
        }

        main.removeCallbacks(watchdog);
        main.postDelayed(finishFallback, FINISH_FALLBACK_MS);
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

    /** The bars show the new page's icons while it covers at least half the screen. */
    private void updateIcons() {
        if (!drawable.playing) return;
        final float newPage = opening ? s : 1f - s;
        final boolean target = newPage >= 0.5f;
        if (target == showsTarget) return;
        showsTarget = target;
        applyIcons(false);
    }

    /** Applies the target (the page's latest request) or the old icons, only when they differ. */
    private void applyIcons(boolean force) {
        final Activity activity = getActivity();
        if (activity == null) return;
        final Boolean pageStatus = SystemUiHelper.pageStatusLightIcons();
        final Boolean pageNav = SystemUiHelper.pageNavLightIcons();
        final boolean statusLight = (showsTarget && pageStatus != null) ? pageStatus : oldStatusLight;
        final boolean navLight = (showsTarget && pageNav != null) ? pageNav : oldNavLight;
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
     * The one way a picture leaves the screen. Ends the animation, puts the
     * WebView back in place and removes the picture (both in this frame),
     * settles every pending call, releases the icon hold and schedules the
     * screenshot's release. Idempotent.
     */
    private void tearDown() {
        generation++;
        main.removeCallbacks(watchdog);
        main.removeCallbacks(finishFallback);
        Choreographer.getInstance().removeFrameCallback(firstFrameShown);
        stopAnimatorSilently();
        playWaiting = false;
        reverseBeforeStart = false;
        capturing = false;

        if (webView != null) {
            restWebView(webView);
            webView.getSettings().setOffscreenPreRaster(false);
        }
        if (attached) {
            attached = false;
            if (host != null) {
                host.removeOnLayoutChangeListener(hostResized);
                host.getOverlay().remove(drawable);
            }
            if (drawable != null) {
                drawable.bitmap = null;
                drawable.playing = false;
            }
        }
        host = null;
        webView = null;

        if (beginCall != null) {
            final PluginCall pending = beginCall;
            beginCall = null;
            pending.reject("page transition torn down before the picture was shown", "cancelled");
        }
        if (playCall != null) {
            // The picture is gone, so what is on screen is the page as it is now.
            final PluginCall pending = playCall;
            playCall = null;
            pending.resolve(state("done", true));
        }
        finishing = false;
        if (!finishCalls.isEmpty()) {
            for (int i = 0; i < finishCalls.size(); i++) finishCalls.get(i).resolve();
            finishCalls.clear();
        }

        SystemUiHelper.releaseIcons(getActivity(), this);
        scheduleBitmapRelease();
    }

    /** Whatever an effect did to the WebView's transform, undone. */
    private static void restWebView(WebView web) {
        if (web.getTranslationX() != 0f) web.setTranslationX(0f);
        if (web.getTranslationY() != 0f) web.setTranslationY(0f);
        if (web.getScaleX() != 1f) web.setScaleX(1f);
        if (web.getScaleY() != 1f) web.setScaleY(1f);
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
     * Leaving the screen ends any transition: the picture must never be what the
     * user comes back to. The page sees play resolve {state:"done",
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

    private static JSObject state(String state, boolean interrupted) {
        final JSObject result = new JSObject();
        result.put("state", state);
        if (interrupted) result.put("interrupted", true);
        return result;
    }

    /**
     * The picture. Before play() it is the screenshot as taken; during it, the
     * other page, as the effect draws it.
     */
    private static final class PagesDrawable extends Drawable {
        private final Paint bitmapPaint = new Paint();
        private final Runnable onFirstDraw;

        Bitmap bitmap;
        boolean awaitingFirstDraw;
        /** False until play() starts moving: the screenshot is drawn as it was taken. */
        boolean playing;
        private PageEffect effect;

        PagesDrawable(Runnable onFirstDraw) {
            this.onFirstDraw = onFirstDraw;
        }

        /** From now on the picture is the other page, drawn by `effect`. */
        void start(PageEffect effect) {
            this.effect = effect;
            playing = true;
        }

        @Override
        public void draw(@NonNull Canvas canvas) {
            final Bitmap b = bitmap;
            if (b == null || b.isRecycled()) return;
            if (!playing) {
                canvas.drawBitmap(b, 0f, 0f, bitmapPaint);
            } else if (effect != null) {
                effect.draw(canvas, b, getBounds().width(), getBounds().height());
            }
            if (awaitingFirstDraw) {
                awaitingFirstDraw = false;
                onFirstDraw.run();
            }
        }

        @Override
        public void setAlpha(int alpha) {
            bitmapPaint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(ColorFilter colorFilter) {
            bitmapPaint.setColorFilter(colorFilter);
        }

        @Override
        @SuppressWarnings("deprecation")
        public int getOpacity() {
            return PixelFormat.TRANSLUCENT;
        }
    }
}
