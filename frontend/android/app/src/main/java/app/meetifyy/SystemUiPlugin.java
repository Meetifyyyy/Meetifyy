package app.meetifyy;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;

import androidx.appcompat.app.AppCompatDelegate;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the status bar and the navigation bar to match the app's own theme.
 *
 * Persists the user's theme selection into SharedPreferences so MainActivity
 * can resolve and apply it on cold start before any UI / splash screen is rendered.
 */
@CapacitorPlugin(name = "SystemUi")
public class SystemUiPlugin extends Plugin {

    public static final String PREFS = SystemUiHelper.PREFS;
    public static final String KEY_BACKGROUND = SystemUiHelper.KEY_BACKGROUND;

    /**
     * @param call `background`: CSS hex color string (e.g. #FFFFFF or #000000)
     *             `lightIcons`: true when icons must be light (dark background)
     *             `theme`: optional "light", "dark", or "system"
     *             `preferenceSet`: optional boolean indicating explicit user choice
     */
    @PluginMethod
    public void setColors(PluginCall call) {
        final String background = call.getString("background");
        final boolean lightIcons = Boolean.TRUE.equals(call.getBoolean("lightIcons", false));
        final String theme = call.getString("theme", null);
        final Boolean preferenceSet = call.getBoolean("preferenceSet", null);

        if (background == null || background.isEmpty()) {
            call.reject("background is required");
            return;
        }

        final int color;
        try {
            color = Color.parseColor(background);
        } catch (IllegalArgumentException e) {
            call.reject("unparseable colour: " + background);
            return;
        }

        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }

        activity.runOnUiThread(() -> {
            final boolean isDark = lightIcons;

            // Apply system bars immediately with full API 29+ / 35+ support
            SystemUiHelper.applySystemBars(activity, isDark, color);

            // Synchronize AppCompat night mode so resources and configuration stay aligned
            if (Boolean.TRUE.equals(preferenceSet) && theme != null) {
                if ("dark".equalsIgnoreCase(theme)) {
                    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES);
                } else if ("light".equalsIgnoreCase(theme)) {
                    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);
                } else {
                    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);
                }
            }

            // Persist preferences for next cold start
            final SharedPreferences prefs =
                activity.getSharedPreferences(SystemUiHelper.PREFS, Activity.MODE_PRIVATE);
            final SharedPreferences.Editor editor = prefs.edit();
            editor.putInt(SystemUiHelper.KEY_BACKGROUND, color);
            editor.putBoolean(SystemUiHelper.KEY_LIGHT_ICONS, lightIcons);
            if (theme != null) {
                editor.putString(SystemUiHelper.KEY_THEME, theme);
            }
            if (Boolean.TRUE.equals(preferenceSet)) {
                editor.putBoolean(SystemUiHelper.KEY_PREFERENCE_SET, true);
            } else if ("system".equalsIgnoreCase(theme)) {
                editor.putBoolean(SystemUiHelper.KEY_PREFERENCE_SET, false);
            }
            editor.apply();

            call.resolve();
        });
    }
}
