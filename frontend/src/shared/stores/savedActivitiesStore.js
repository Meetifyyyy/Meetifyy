import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useSavedActivitiesStore = create(
  persist(
    (set, get) => ({
      savedActivities: [],
      toggleSaveActivity: (id) => {
        const current = get().savedActivities;
        if (current.includes(id)) {
          set({ savedActivities: current.filter((x) => x !== id) });
        } else {
          set({ savedActivities: [...current, id] });
        }
      },
      isSaved: (id) => get().savedActivities.includes(id),
      clearAll: () => {
        set({ savedActivities: [] });
      },
    }),
    {
      name: 'saved-activities-storage',
    }
  )
);
