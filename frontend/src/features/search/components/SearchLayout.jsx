import RightPanel, { UpcomingEvents } from '@layout/RightPanel';
import ProfileRightSidebar from '@features/profile/components/ProfileRightSidebar';

/**
 * The frame every search page renders in: the results column, and on large
 * screens a discovery column beside it.
 *
 * One layout for the whole Search experience, so global search and community
 * search cannot drift apart. The side column is the same components the rest
 * of the app already shows ("Who to follow", "Discover Communities", upcoming
 * events), ordered by what the viewer is searching for, so it answers "what
 * else is there" for the current section. `RightPanel` makes it sticky and
 * renders nothing below 1100px, so phones and tablets never mount it or fetch
 * for it.
 */
export default function SearchLayout({ section = 'all', mainRef, mainClassName = '', children }) {
  const eventsFirst = section === 'activities';

  return (
    <>
      <main ref={mainRef} className={`centre centre--sheet centre--search animate-in ${mainClassName}`.trim()}>
        {children}
      </main>
      <RightPanel className="animate-in">
        {eventsFirst && <UpcomingEvents />}
        <ProfileRightSidebar embedded />
        {!eventsFirst && <UpcomingEvents />}
      </RightPanel>
    </>
  );
}
