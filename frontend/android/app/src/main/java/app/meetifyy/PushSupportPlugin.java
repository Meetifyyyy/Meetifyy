package app.meetifyy;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The two things push needs that no stock plugin offers.
 *
 * status(): whether this build carries its Firebase configuration. The
 * google-services Gradle plugin turns google-services.json into string
 * resources at build time; without them the Firebase SDK is never
 * initialised and PushNotifications.register() throws, so the web layer asks
 * here first and simply reports push as unavailable. See
 * docs/push-notifications.md.
 *
 * openSettings(): this app's notification settings. After two denials on
 * Android 13+ the permission dialog no longer appears, and the system screen
 * is the only place the person can turn notifications back on.
 */
@CapacitorPlugin(name = "PushSupport")
public class PushSupportPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        int id = getContext().getResources()
            .getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("configured", id != 0);
        call.resolve(result);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open notification settings");
        }
    }
}
