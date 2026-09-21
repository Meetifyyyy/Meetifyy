package app.meetifyy;

import android.app.Application;

import androidx.appcompat.app.AppCompatDelegate;

/**
 * Custom Application class for Meetifyy.
 *
 * Runs before any Activity is instantiated. Resolves persisted theme preference
 * and pre-configures AppCompat night mode so all resources and themes in this
 * process resolve to the user's chosen theme from the very first frame.
 */
public class MeetifyyApplication extends Application {

    @Override
    public void onCreate() {
        super.onCreate();

        final SystemUiHelper.ResolvedTheme resolved = SystemUiHelper.resolveTheme(this);
        if (resolved.preferenceSet) {
            if ("dark".equalsIgnoreCase(resolved.themeMode)) {
                AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES);
            } else if ("light".equalsIgnoreCase(resolved.themeMode)) {
                AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);
            }
        } else {
            AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);
        }
    }
}
