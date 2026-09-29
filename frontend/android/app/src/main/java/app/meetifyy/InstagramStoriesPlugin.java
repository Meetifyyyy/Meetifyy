package app.meetifyy;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.regex.Pattern;

/**
 * Instagram's "Add to Story" composer, with a Meetifyy card placed on it.
 *
 * This is Meta's documented Android flow for sharing to Stories
 * (developers.facebook.com/docs/instagram-platform/sharing-to-stories):
 *
 *   action   com.instagram.share.ADD_TO_STORY
 *   extra    source_application     the Meta App ID. Required since January
 *                                   2023; without it Instagram opens and
 *                                   refuses the share.
 *   extra    interactive_asset_uri  the STICKER: a content:// URI to a PNG
 *                                   the person can move, resize and rotate.
 *   extras   top_background_color / bottom_background_color
 *                                   the gradient Instagram draws behind it.
 *
 * The card is written to the app's cache under {@code instagram-stories/},
 * the one directory res/xml/file_paths.xml exposes for this, and read
 * permission on that single URI is granted to Instagram's package alone.
 *
 * Instagram reports nothing back — not whether the story was posted, not
 * whether the person backed out — so {@link #share} resolves once the
 * composer has been launched, and that is all it claims.
 *
 * WHAT THIS CANNOT DO
 * Attach a link. Meta's third-party API has no link extra: a tappable story
 * link exists only as Instagram's own Link sticker, added by the person in
 * the composer. The sticker passed here is an image.
 */
@CapacitorPlugin(name = "InstagramStories")
public class InstagramStoriesPlugin extends Plugin {

    private static final String TAG = "InstagramStories";
    private static final String INSTAGRAM_PACKAGE = "com.instagram.android";
    private static final String ACTION_ADD_TO_STORY = "com.instagram.share.ADD_TO_STORY";
    private static final String MIME_PNG = "image/png";
    private static final String CACHE_DIR = "instagram-stories";
    /** A decoded card is a few hundred KB; this refuses anything absurd. */
    private static final int MAX_ASSET_BYTES = 12 * 1024 * 1024;
    /**
     * Instagram reads the file after this call has returned, at a time it
     * chooses, so a card cannot be deleted as soon as it is handed over. Cards
     * older than this are removed on the next share and on plugin load.
     */
    private static final long STALE_AFTER_MS = 10 * 60 * 1000L;
    private static final Pattern HEX_COLOUR = Pattern.compile("^#[0-9A-Fa-f]{6}$");
    private static final Pattern APP_ID = Pattern.compile("^[0-9]{5,20}$");

    @Override
    public void load() {
        cleanUp(STALE_AFTER_MS);
    }

    /** Whether Instagram is installed and accepts this share. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        final JSObject result = new JSObject();
        result.put("available", resolves(buildIntent(null)));
        call.resolve(result);
    }

    @PluginMethod
    public void share(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("The app is not in the foreground", "LAUNCH_FAILED");
            return;
        }

        final String appId = call.getString("appId", "");
        if (appId == null || !APP_ID.matcher(appId).matches()) {
            call.reject("Instagram Stories is not configured for this build", "MISSING_APP_ID");
            return;
        }

        final String top = colourOr(call.getString("backgroundTopColor"), "#1D4ED8");
        final String bottom = colourOr(call.getString("backgroundBottomColor"), "#0F172A");

        final byte[] png;
        try {
            final String encoded = call.getString("stickerPngBase64", "");
            png = encoded == null ? new byte[0] : Base64.decode(encoded, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("The story card was not valid image data", "INVALID_ASSET", e);
            return;
        }
        if (!isPng(png) || png.length > MAX_ASSET_BYTES) {
            call.reject("The story card was not a usable PNG", "INVALID_ASSET");
            return;
        }

        if (!resolves(buildIntent(null))) {
            call.reject("Instagram is not installed", "INSTAGRAM_NOT_INSTALLED");
            return;
        }

        final Uri uri;
        try {
            cleanUp(STALE_AFTER_MS);
            final File file = writeCard(png);
            uri = FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", file
            );
        } catch (IOException | IllegalArgumentException e) {
            Log.w(TAG, "could not stage the story card", e);
            call.reject("The story card could not be prepared", "FILE_ERROR", e);
            return;
        }

        final Intent intent = buildIntent(uri);
        intent.putExtra("source_application", appId);
        intent.putExtra("top_background_color", top);
        intent.putExtra("bottom_background_color", bottom);
        // The sticker is read through an extra, which FLAG_GRANT_READ_URI_PERMISSION
        // on the intent does not cover; the grant has to name the package.
        activity.grantUriPermission(INSTAGRAM_PACKAGE, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);

        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException e) {
                call.reject("Instagram is not installed", "INSTAGRAM_NOT_INSTALLED", e);
            } catch (RuntimeException e) {
                Log.w(TAG, "Instagram refused the story intent", e);
                call.reject("Instagram could not be opened", "LAUNCH_FAILED", e);
            }
        });
    }

    /**
     * The ADD_TO_STORY intent, addressed to Instagram only. With no URI it is
     * the availability probe; with one, the sticker. No background image is
     * sent — the background is Instagram's own gradient — so the type names
     * the sticker, which is what Instagram's resolver matches on.
     */
    private Intent buildIntent(Uri sticker) {
        final Intent intent = new Intent(ACTION_ADD_TO_STORY);
        intent.setType(MIME_PNG);
        intent.setPackage(INSTAGRAM_PACKAGE);
        if (sticker != null) {
            intent.putExtra("interactive_asset_uri", sticker);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        return intent;
    }

    /** Requires the {@code <queries>} entry in AndroidManifest.xml on Android 11+. */
    private boolean resolves(Intent intent) {
        final PackageManager pm = getContext().getPackageManager();
        return intent.resolveActivity(pm) != null;
    }

    private File writeCard(byte[] png) throws IOException {
        final File dir = new File(getContext().getCacheDir(), CACHE_DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new IOException("cannot create " + dir);
        }
        final File file = new File(dir, "story-" + System.currentTimeMillis() + ".png");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(png);
            out.getFD().sync();
        }
        return file;
    }

    /** Removes cards older than {@code maxAgeMs}; never throws. */
    private void cleanUp(long maxAgeMs) {
        final File dir = new File(getContext().getCacheDir(), CACHE_DIR);
        final File[] files = dir.listFiles();
        if (files == null) return;
        final long now = System.currentTimeMillis();
        for (File file : files) {
            if (now - file.lastModified() > maxAgeMs && !file.delete()) {
                Log.w(TAG, "could not delete " + file.getName());
            }
        }
    }

    private static boolean isPng(byte[] data) {
        return data.length > 8
            && (data[0] & 0xFF) == 0x89
            && data[1] == 'P' && data[2] == 'N' && data[3] == 'G';
    }

    private static String colourOr(String value, String fallback) {
        return value != null && HEX_COLOUR.matcher(value).matches() ? value : fallback;
    }
}
