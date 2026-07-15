import { getRelativeDateLabel } from '@shared/utils/time';

const ACTIVITY_CATEGORIES = [
  'Sports', 'Learning', 'Professional', 'Travel', 'Creative', 'Social', 'Health & Fitness', 'Technology', 'Coffee', 'Meetup', 'Hackathon', 'Event'
];

const ACTIVITY_TEMPLATES = [
  { category: 'Learning', title: 'Calculus group study session', description: 'Prepping for the midterm next week. Let\'s solve sample papers together at the CS lounge.', groupSize: 'Small Group', participationType: 'open', tags: ['calculus', 'study'], location: 'CS Lounge, Block AB', isOnline: false },
  { category: 'Learning', title: 'System design practice', description: 'Practicing mock system design questions (scaling databases, queues, CDNs). Great for backend prep.', groupSize: 'Small Group', participationType: 'approval', tags: ['system-design', 'architecture'], location: 'Online - Zoom', isOnline: true },
  { category: 'Technology', title: 'Embedded systems troubleshooting', description: 'Tinkering with custom microcontrollers and control loops. Bring your logic analyzers!', groupSize: '1-on-1', participationType: 'approval', tags: ['arduino', 'hardware'], location: 'Robotics Lab, Room 204', isOnline: false },
  { category: 'Technology', title: 'Web3 smart contracts review', description: 'Peer-reviewing security audits on Solidity token layers. Let\'s optimize gas fees.', groupSize: 'Small Group', participationType: 'approval', tags: ['blockchain', 'security'], location: 'Innovation Lab', isOnline: false },
  { category: 'Social', title: 'Bobatea and chat session', description: 'Casual meetup to talk about web animations, custom transitions, or anything frontend-related.', groupSize: 'Small Group', participationType: 'open', tags: ['boba', 'casual'], location: 'Sweet Treat Cafe', isOnline: false },
  { category: 'Sports', title: 'Billiards double match', description: 'Intermediate game of pool. Looking for two players to make it a team challenge.', groupSize: 'Small Group', participationType: 'open', tags: ['billiards', 'sports'], location: 'Student Union Games Room', isOnline: false },
  { category: 'Health & Fitness', title: 'Morning yoga and stretch', description: 'A relaxing morning outdoor session. Bring your own yoga mat.', groupSize: 'Open', participationType: 'open', tags: ['yoga', 'mindfulness'], location: 'Campus Green Belt', isOnline: false },
  { category: 'Sports', title: 'Table tennis tournament prep', description: 'Looking for a competitive partner to drill serves and blocks before the upcoming cup.', groupSize: '1-on-1', participationType: 'approval', tags: ['pingpong', 'sports'], location: 'Indoor Sports Complex', isOnline: false },
  { category: 'Travel', title: 'Day hike to standard falls', description: 'Carpooling for a scenic trail hike. Splitting fuel expenses.', groupSize: 'Small Group', participationType: 'approval', tags: ['hiking', 'adventure'], location: 'Falls Parking Gate', isOnline: false },
  { category: 'Creative', title: 'Vector Illustration workshop', description: 'Sharing tips on custom SVG patterns and layout illustrations. Beginner friendly.', groupSize: 'Open', participationType: 'open', tags: ['vector', 'design'], location: 'Main Seminar Hall', isOnline: false },
  { category: 'Social', title: 'Board games afternoon', description: 'Playing Settlers of Catan, Ticket to Ride, and custom card games. Snacks provided.', groupSize: 'Small Group', participationType: 'open', tags: ['boardgames', 'fun'], location: 'Student Hub', isOnline: false },
  { category: 'Health & Fitness', title: 'Gym partner - leg day routine', description: 'Need a lift partner for squating and deadlifts support. Keeping each other accountable.', groupSize: '1-on-1', participationType: 'approval', tags: ['weights', 'fitness'], location: 'Main Gym Centre', isOnline: false },
  { category: 'Professional', title: 'Venture pitch deck review', description: 'Co-founders review session. Giving honest critiques on slides, metrics, and business models.', groupSize: 'Small Group', participationType: 'approval', tags: ['pitch', 'business'], location: 'Startup Incubation Cell', isOnline: false },
  { category: 'Professional', title: 'Interaction portfolio reviews', description: 'Constructive reviews of interaction design, user maps, and wireframe prototypes.', groupSize: '1-on-1', participationType: 'approval', tags: ['ux', 'portfolio'], location: 'Online - Google Meet', isOnline: true },
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

export function generateCrewActivities(users) {
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

  // Add a finished activity (past date) where student is a participant
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 2); // 2 days ago
  
  const finishedActivity = {
    id: 'crew_finished_1',
    hostId: 'u2', // Zoe Miller
    hostName: 'Zoe Miller',
    hostUsername: 'zoemiller',
    hostAvatar: 'Z',
    hostCollege: 'IIT Delhi',
    hostVerified: false,
    
    category: 'Creative',
    title: 'GlassyUI Design Brainstorming',
    description: 'Finalized the design token system and spacing specifications for our new component library.',
    coverImage: COVER_IMAGES[0],
    tags: ['design', 'glassmorphism'],
    
    dateLabel: '2 days ago',
    date: pastDate.toISOString(),
    time: '3:00 PM',
    duration: '2 hours',
    location: 'Online - Figma',
    isOnline: true,
    
    participationType: 'approval',
    slotsNeeded: 5,
    slotsFilled: 3,
    
    participants: ['u2', 'u9', 'u4'], // Host, Student, Sophia Li
    requests: [],
    invitedUsers: []
  };

  activities.push(finishedActivity);

  return shuffle(activities);
}

// Helper to group activities by context
export function getRecommendedByContext(currentUser, activities, allUsers) {
  const recommended = shuffle(activities).slice(0, 4);
  const happeningNearby = shuffle(activities).filter(a => !a.isOnline).slice(0, 4);
  const startingSoon = activities.filter(a => a.dateLabel === 'Today' || a.dateLabel === 'Tomorrow').slice(0, 4);
  const recentlyAdded = activities.slice(0, 4); 
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

export { ACTIVITY_CATEGORIES };
