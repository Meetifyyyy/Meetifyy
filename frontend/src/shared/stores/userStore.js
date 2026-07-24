import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * userStore — stub. DataContext still owns users.
 * Migrate follow/unfollow here first, then profile edits, then the full map.
 */
const useUserStore = create(
  immer(() => ({
    // users: {},       // future: migrated from DataContext.users
    // followUser: ...  // future: moved from DataContext
  }))
);

export default useUserStore;
