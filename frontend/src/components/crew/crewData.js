import { getRelativeDateLabel } from '../../utils/time';

const ACTIVITY_CATEGORIES = [
  'Sports', 'Learning', 'Professional', 'Travel', 'Creative', 'Social', 'Health & Fitness', 'Technology', 'Coffee', 'Meetup', 'Hackathon', 'Event'
];

const ACTIVITY_TEMPLATES = [
  { category: 'Learning', title: 'Finals library study session', description: 'Looking for a quiet study session at the main library to prep for finals. Bring your own snacks.', groupSize: 'Small Group', participationType: 'open', tags: ['study', 'quiet'], location: 'Main Library, 2nd Floor', isOnline: false },
  { category: 'Learning', title: 'Interview coding practice', description: 'We will be doing mock interviews and Leetcode pair programming. Good for anyone prepping for software engineering roles.', groupSize: 'Small Group', participationType: 'approval', tags: ['coding', 'interviews'], location: 'Computer Science Building, Room 102', isOnline: false },
  { category: 'Technology', title: 'Late-night DSA prep session', description: 'Deep dive into Data Structures and Algorithms. Need a partner to stay accountable.', groupSize: '1-on-1', participationType: 'approval', tags: ['DSA', 'CS'], location: 'Online - Discord', isOnline: true },
  { category: 'Technology', title: 'HackMIT weekend teaming', description: 'I have an idea for an AI-powered education tool. Need a frontend dev and designer.', groupSize: 'Small Group', participationType: 'approval', tags: ['hackathon', 'ai'], location: 'MIT Campus', isOnline: false },
  { category: 'Social', title: 'Casual coffee meetup', description: 'Just looking to meet new people over some good coffee. No agenda, just vibes.', groupSize: 'Small Group', participationType: 'open', tags: ['coffee', 'casual'], location: 'Blue Bottle Coffee Downtown', isOnline: false },
  { category: 'Sports', title: '3v3 basketball: Need 2 players', description: 'We play casually every weekend. Need two more to make it a 3v3.', groupSize: 'Small Group', participationType: 'open', tags: ['basketball', 'sports'], location: 'Campus Rec Center Courts', isOnline: false },
  { category: 'Health & Fitness', title: 'Morning campus run group', description: 'A slow-paced 5k run around the campus perimeter. All levels welcome.', groupSize: 'Open', participationType: 'open', tags: ['running', 'fitness'], location: 'Main Gate', isOnline: false },
  { category: 'Sports', title: 'Tennis doubles match', description: 'Looking for an intermediate pair to play against. We have the court booked.', groupSize: 'Small Group', participationType: 'approval', tags: ['tennis', 'doubles'], location: 'City Tennis Club', isOnline: false },
  { category: 'Travel', title: 'Weekend trip to the mountains', description: 'Planning a hike and an overnight stay in a cabin. Splitting costs.', groupSize: 'Small Group', participationType: 'approval', tags: ['hiking', 'travel'], location: 'Mountain Base Camp', isOnline: false },
  { category: 'Creative', title: 'Photography Walk Downtown', description: 'Exploring the architecture and street scenes. Bring whatever camera you have.', groupSize: 'Open', participationType: 'open', tags: ['photography', 'art'], location: 'Downtown Square', isOnline: false },
  { category: 'Social', title: 'Movie Night: Interstellar', description: 'Hosting a watch party for Interstellar. I have a projector and popcorn.', groupSize: 'Small Group', participationType: 'open', tags: ['movies', 'scifi'], location: 'My Apartment (Will share address)', isOnline: false },
  { category: 'Health & Fitness', title: 'Evening gym partner', description: 'Looking for someone to spot me and stay consistent with a PPL split.', groupSize: '1-on-1', participationType: 'approval', tags: ['gym', 'lifting'], location: 'Campus Gym', isOnline: false },
  { category: 'Professional', title: 'Startup founders lunch meetup', description: 'Casual networking for early-stage founders to share struggles and wins.', groupSize: 'Small Group', participationType: 'approval', tags: ['startup', 'networking'], location: 'Innovation Hub Cafe', isOnline: false },
  { category: 'Professional', title: 'Portfolio review session', description: 'Let\'s review each other\'s design portfolios and give honest feedback.', groupSize: '1-on-1', participationType: 'approval', tags: ['design', 'portfolio'], location: 'Online - Google Meet', isOnline: true },
];

const DATES = [
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'This Weekend', offset: 3 },
  { label: 'Next Week', offset: 7 }
];

const TIMES = ['10:00 AM', '2:00 PM', '5:30 PM', '8:00 PM'];
const DURATIONS = ['1 hour', '2 hours', 'Half day', 'All day'];
const COVER_IMAGES = [
  'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1000&auto=format&fit=crop', // Group study
  'https://images.unsplash.com/photo-1511884642898-4c92249e20b6?q=80&w=1000&auto=format&fit=crop', // Landscape/Travel
  'https://images.unsplash.com/photo-1552508744-1696d4464960?q=80&w=1000&auto=format&fit=crop', // Coffee/Meeting
  'https://images.unsplash.com/photo-1517649763962-0c623066013b?q=80&w=1000&auto=format&fit=crop', // Sports/Gym
  'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?q=80&w=1000&auto=format&fit=crop', // Running
  'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?q=80&w=1000&auto=format&fit=crop', // Tech/Coding
  'https://images.unsplash.com/photo-1543269865-cbf427effbad?q=80&w=1000&auto=format&fit=crop', // Group discussion
  'https://images.unsplash.com/photo-1528605105345-5344ea20e269?q=80&w=1000&auto=format&fit=crop', // Movie/Creative
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getCollegeName(users, host) {
  if (!host.collegeId) return null;
  return host.collegeId === 'gla' ? 'GLA University' : host.collegeId === 'iitdelhi' ? 'IIT Delhi' : 'University';
}

function generateCrewActivities(users) {
  const userList = Object.values(users);
  const activities = [];

  userList.forEach((user, ui) => {
    const count = 2 + Math.floor(Math.random() * 3);
    const userActivities = shuffle(ACTIVITY_TEMPLATES).slice(0, count);

    userActivities.forEach((template, i) => {
      const dateObj = DATES[Math.floor(Math.random() * DATES.length)];
      const timeStr = TIMES[Math.floor(Math.random() * TIMES.length)];
      const durationStr = DURATIONS[Math.floor(Math.random() * DURATIONS.length)];
      
      let slots = 10;
      if (template.groupSize === '1-on-1') slots = 1;
      else if (template.groupSize === 'Small Group') slots = 2 + Math.floor(Math.random() * 4);

      const realDate = new Date();
      realDate.setDate(realDate.getDate() + dateObj.offset);

      const activity = {
        id: `crew_${ui}_${i}`,
        hostId: user.id,
        hostName: user.displayName,
        hostUsername: user.username,
        hostAvatar: user.avatar,
        hostCollege: getCollegeName(users, user),
        hostVerified: user.verified || false,
        
        category: template.category,
        title: template.title,
        description: template.description,
        coverImage: COVER_IMAGES[Math.floor(Math.random() * COVER_IMAGES.length)],
        tags: template.tags,
        
        dateLabel: getRelativeDateLabel(realDate.toISOString()),
        date: realDate.toISOString(),
        time: timeStr,
        duration: durationStr,
        location: template.location,
        isOnline: template.isOnline,
        
        participationType: template.participationType, // 'open' or 'approval'
        slotsNeeded: slots,
        slotsFilled: Math.floor(Math.random() * Math.max(0, slots)),
        
        participants: [user.id], // Just mock host as participant for now
        requests: [],
        invitedUsers: []
      };
      
      // Add random participants
      for (let p = 0; p < activity.slotsFilled; p++) {
          const randomUser = userList[Math.floor(Math.random() * userList.length)];
          if (!activity.participants.includes(randomUser.id)) {
              activity.participants.push(randomUser.id);
          }
      }

      activities.push(activity);
    });
  });

  return shuffle(activities);
}

// Helper to group activities by context
export function getRecommendedByContext(currentUser, activities, allUsers) {
  // Simplistic mock: We will just group by some logic to simulate the requested sections.
  
  const recommended = shuffle(activities).slice(0, 4);
  const happeningNearby = shuffle(activities).filter(a => !a.isOnline).slice(0, 4);
  const startingSoon = activities.filter(a => a.dateLabel === 'Today' || a.dateLabel === 'Tomorrow').slice(0, 4);
  const recentlyAdded = activities.slice(0, 4); // assume first few are recently added
  const popular = [...activities].sort((a, b) => b.slotsFilled - a.slotsFilled).slice(0, 4);

  return {
    recommended,
    happeningNearby,
    startingSoon,
    recentlyAdded,
    popular
  };
}

export function filterActivities(activities, filters) {
  return activities.filter(a => {
    if (filters.category && a.category !== filters.category) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!a.title.toLowerCase().includes(q) &&
          !a.hostName.toLowerCase().includes(q) &&
          !(a.category || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

export function getUpcomingPlans(currentUser, activities) {
  return activities.filter(a => a.participants.includes(currentUser.id) || a.hostId === currentUser.id).slice(0, 4);
}

export { generateCrewActivities, ACTIVITY_CATEGORIES };
