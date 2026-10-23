import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { activitiesApi } from '../api/apiClient';
import { blockIfOffline } from '../lib/offlineGuard';

export const useSavedActivitiesStore = create(
  persist(
    (set, get) => ({
      savedActivities: [],
      toggleSaveActivity: async (id) => {
        if (!id) return;
        // A toggle is refused offline rather than flipped and rolled back.
        if (blockIfOffline('action')) return;
        const current = get().savedActivities;
        const isSavedAlready = current.includes(id);

        // Optimistic update
        if (isSavedAlready) {
          set({ savedActivities: current.filter((x) => x !== id) });
        } else {
          set({ savedActivities: [...current, id] });
        }

        try {
          if (isSavedAlready) {
            await activitiesApi.unbookmark(id);
          } else {
            await activitiesApi.bookmark(id);
          }
        } catch (err) {
          // Revert optimistic update on failure
          if (isSavedAlready) {
            set({ savedActivities: [...get().savedActivities, id] });
          } else {
            set({ savedActivities: get().savedActivities.filter((x) => x !== id) });
          }
        }
      },
      fetchSavedActivityIds: async () => {
        try {
          const ids = await activitiesApi.getBookmarkIds();
          if (Array.isArray(ids)) {
            set({ savedActivities: ids });
          }
        } catch (err) {
          // Silent fallback to persisted storage
        }
      },
      isSaved: (id) => get().savedActivities.includes(id),
      hydrateFromServer: (ids) => {
        if (Array.isArray(ids)) {
          set({ savedActivities: ids });
        }
      },
      clearAll: () => {
        set({ savedActivities: [] });
      },
    }),
    {
      name: 'saved-activities-storage',
    }
  )
);
