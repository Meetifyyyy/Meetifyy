package app.meetifyy;

import android.graphics.Bitmap;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Capacitor's chrome client, with one change: no default video poster.
 *
 * Android's WebView paints its own placeholder — a grey box with a large
 * black play glyph — for every <video> that has no poster yet, or whose
 * poster has not loaded. On the website the same element is simply dark
 * until a frame or the poster arrives; in the app every video in the feed,
 * a chat and the viewer showed that placeholder first, and kept it for any
 * clip without a poster image.
 *
 * Returning a transparent 1x1 bitmap removes it everywhere at once, so what
 * shows instead is the page's own video background (and its poster, when
 * there is one). Everything else — file choosers, permissions, fullscreen
 * custom views — stays Capacitor's.
 */
public class MeetifyyChromeClient extends BridgeWebChromeClient {
    private Bitmap transparentPoster;

    public MeetifyyChromeClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public Bitmap getDefaultVideoPoster() {
        if (transparentPoster == null) {
            transparentPoster = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            transparentPoster.eraseColor(0x00000000);
        }
        return transparentPoster;
    }
}
