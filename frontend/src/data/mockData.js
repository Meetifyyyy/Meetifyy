export const initialUsers = {
  alicechen: {
    id: 'u1',
    username: 'alicechen',
    displayName: 'Alice Chen',
    avatar: 'A',
    avatarUrl: null,
    bio: 'Building cool stuff & meeting awesome people. I love experimenting with new technologies, creating unique user experiences, and exploring the unknown.',
    location: 'New York, NY',
    role: 'Full-stack Developer',
    email: 'alicechen@meetify.app',
    followers: 8401,
    following: 161,
    communities: ['Startup Hub', 'Hackathon Heroes', 'GLA University'],
    course: 'B.Tech CS',
    year: '4th Year',
    collegeId: 'gla',
    verified: true,
    interests: ['AI', 'Startups', 'Product Design', 'Web Development', 'Hackathons', 'Open Source'],
    skills: ['React', 'Node.js', 'Figma', 'Python', 'Machine Learning', 'TypeScript', 'Next.js'],
    projects: [
      {
        id: 'proj_1',
        title: 'Meetify',
        description: 'Social platform connecting college students through shared interests, communities, and events.',
        technologies: ['React', 'Node.js', 'MongoDB', 'WebSocket'],
        image: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&h=400&fit=crop',
        link: '#',
        type: 'Project'
      },
      {
        id: 'proj_2',
        title: 'AI Study Buddy',
        description: 'An AI-powered study assistant built during a 48-hour hackathon using Whisper + GPT-4o.',
        technologies: ['Python', 'OpenAI', 'React Native', 'FastAPI'],
        image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=400&fit=crop',
        link: '#',
        type: 'Hackathon Project'
      }
    ],
    achievements: [
      { id: 'ach_1', title: 'Best Hackathon Project', description: 'Won first place at HackMIT 2025', icon: '🏆', date: 'Mar 2025' },
      { id: 'ach_2', title: '100 Days of Code', description: 'Completed 100 consecutive days of coding', icon: '💻', date: 'Jan 2025' },
      { id: 'ach_3', title: 'Top Contributor', description: 'Most active member in Startup Hub community', icon: '⭐', date: 'Dec 2024' }
    ],
    activityLog: [
      { type: 'post', text: 'Built a project at Hackathon Heroes', icon: '🚀', time: '2 hours ago', link: '#' },
      { type: 'post', text: 'Posted in AI/ML Enthusiasts', icon: '🤖', time: '5 hours ago', link: '#' },
      { type: 'join', text: 'Joined Startup Hub', icon: '🎉', time: '3 days ago', link: '/communities/startup' },
      { type: 'achievement', text: 'Won a design challenge', icon: '🏆', time: '1 week ago', link: '#' },
      { type: 'milestone', text: 'Reached 8K followers', icon: '🌟', time: '2 weeks ago', link: '#' },
      { type: 'event', text: 'Attended Tech Fest 2026', icon: '📅', time: '3 weeks ago', link: '#' },
      { type: 'discussion', text: 'Started discussion in GLA University', icon: '💬', time: '1 month ago', link: '#' }
    ],
    socialLinks: {
      github: 'https://github.com/alicechen',
      linkedin: 'https://linkedin.com/in/alicechen',
      twitter: 'https://twitter.com/alicechen',
      website: 'https://alicechen.dev'
    },
    communitiesJoined: 5,
    eventsAttended: 12,
    connectionsMade: 48,
    projectsShared: 7,
    postsThisMonth: 12,
    profileVisitsThisWeek: 47,
    newConnectionsThisWeek: 3,
    recentlyActive: true,
    memberSince: 'Aug 2023'
  },
  marcusrivera: {
    id: 'u2',
    username: 'marcusrivera',
    displayName: 'Marcus Rivera',
    avatar: 'M',
    avatarUrl: null,
    bio: 'Product Designer focused on mental wellness and accessible UX. Always looking for new challenges.',
    location: 'San Francisco, CA',
    role: 'UI/UX Designer',
    email: 'marcus@meetify.app',
    followers: 5230,
    following: 340,
    communities: ['Design Buddies', 'IIT Delhi', 'Startup Hub'],
    course: 'B.Tech IT',
    year: '3rd Year',
    collegeId: 'iitdelhi',
    verified: false,
    interests: ['UI/UX Design', 'Mental Health Tech', 'Accessibility', 'Design Systems', 'Branding'],
    skills: ['Figma', 'Adobe XD', 'Prototyping', 'User Research', 'CSS/SCSS', 'Design Tokens'],
    projects: [
      {
        id: 'proj_3',
        title: 'MindWell App',
        description: 'Mental wellness app focused on accessible UX and inclusive design principles.',
        technologies: ['Figma', 'React Native', 'TypeScript'],
        image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&h=400&fit=crop',
        link: '#',
        type: 'Project'
      }
    ],
    achievements: [
      { id: 'ach_4', title: 'Design System Award', description: 'Recognized for building a comprehensive design system', icon: '🎨', date: 'Feb 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Shared a UX research case study', icon: '📝', time: '1 day ago', link: '#' },
      { type: 'join', text: 'Joined Design Buddies', icon: '🎉', time: '1 week ago', link: '/communities/design' },
      { type: 'event', text: 'Attended UX Summit 2026', icon: '📅', time: '2 weeks ago', link: '#' }
    ],
    socialLinks: {
      linkedin: 'https://linkedin.com/in/marcusrivera',
      website: 'https://marcusrivera.design'
    },
    communitiesJoined: 3,
    eventsAttended: 8,
    connectionsMade: 24,
    projectsShared: 3,
    postsThisMonth: 5,
    profileVisitsThisWeek: 32,
    newConnectionsThisWeek: 1,
    recentlyActive: true,
    memberSince: 'Oct 2023'
  },
  priyasharma: {
    id: 'u3',
    username: 'priyasharma',
    displayName: 'Priya Sharma',
    avatar: 'P',
    avatarUrl: null,
    bio: 'Self-taught ML Engineer. Passionate about democratizing AI education.',
    location: 'Remote',
    role: 'ML Engineer',
    email: 'priya@meetify.app',
    followers: 12500,
    following: 50,
    communities: ['AI/ML Enthusiasts', 'GLA University', 'Hackathon Heroes'],
    course: 'BCA',
    year: '2nd Year',
    collegeId: 'gla',
    verified: true,
    interests: ['Machine Learning', 'AI Education', 'Open Source', 'NLP', 'Deep Learning'],
    skills: ['Python', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'Hugging Face', 'SQL'],
    projects: [
      {
        id: 'proj_4',
        title: 'EduAI Platform',
        description: 'Democratizing AI education through interactive tutorials and hands-on projects.',
        technologies: ['Python', 'Streamlit', 'Hugging Face', 'Docker'],
        image: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&h=400&fit=crop',
        link: '#',
        type: 'Project'
      }
    ],
    achievements: [
      { id: 'ach_5', title: 'AI Educator Award', description: 'Recognized for contributions to AI education', icon: '🎓', date: 'Jan 2025' },
      { id: 'ach_6', title: 'Paper Published', description: 'Co-authored a paper on accessible ML education', icon: '📄', date: 'Nov 2024' }
    ],
    activityLog: [
      { type: 'post', text: 'Shared ML learning resources', icon: '🤖', time: '3 hours ago', link: '#' },
      { type: 'milestone', text: 'Reached 12.5K followers', icon: '🌟', time: '1 week ago', link: '#' },
      { type: 'discussion', text: 'Started AI study group', icon: '💬', time: '2 weeks ago', link: '#' }
    ],
    socialLinks: {
      github: 'https://github.com/priyasharma',
      twitter: 'https://twitter.com/priyasharma'
    },
    communitiesJoined: 4,
    eventsAttended: 15,
    connectionsMade: 89,
    projectsShared: 5,
    postsThisMonth: 18,
    profileVisitsThisWeek: 89,
    newConnectionsThisWeek: 7,
    recentlyActive: true,
    memberSince: 'Jan 2024'
  },
  sammydoe: {
    id: 'u4',
    username: 'sammydoe',
    displayName: 'Sammy Doe',
    avatar: 'S',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?fit=crop&w=150&h=150',
    bio: 'Frontend enthusiast. Glassmorphism is the future.',
    location: 'London, UK',
    role: 'Frontend Dev',
    email: 'sammy@meetify.app',
    followers: 1200,
    following: 400,
    communities: ['Design Buddies', 'IIT Delhi', 'Gaming & E-Sports'],
    course: 'MCA',
    year: '1st Year',
    collegeId: 'iitdelhi',
    verified: false,
    interests: ['Frontend', 'CSS Art', 'WebGL', 'Three.js', 'UI Animation'],
    skills: ['React', 'Three.js', 'CSS/SASS', 'JavaScript', 'WebGL', 'GSAP'],
    projects: [],
    achievements: [],
    activityLog: [
      { type: 'post', text: 'Deployed portfolio with Three.js', icon: '🌍', time: '2 days ago', link: '#' }
    ],
    socialLinks: {
      github: 'https://github.com/sammydoe',
      website: 'https://sammydoe.dev'
    },
    communitiesJoined: 3,
    eventsAttended: 2,
    connectionsMade: 15,
    projectsShared: 1,
    postsThisMonth: 3,
    profileVisitsThisWeek: 12,
    newConnectionsThisWeek: 0,
    recentlyActive: false,
    memberSince: 'Mar 2024'
  },
  alexq: {
    id: 'u5',
    username: 'alexq',
    displayName: 'Alex Q.',
    avatar: 'A',
    avatarUrl: null,
    bio: 'Hardware engineer turning software. Building IoT projects and exploring Rust for embedded systems.',
    location: 'Austin, TX',
    role: 'Software Engineer',
    email: 'alexq@meetify.app',
    followers: 890,
    following: 120,
    communities: ['GLA University', 'AI/ML Enthusiasts'],
    course: 'B.Tech ME',
    year: '4th Year',
    collegeId: 'gla',
    verified: false,
    interests: ['Embedded Systems', 'IoT', 'Rust', 'AI'],
    skills: ['C++', 'Rust', 'Python', 'Arduino', 'Embedded Linux'],
    projects: [
      {
        id: 'proj_alex_1',
        title: 'SmartHome Controller',
        description: 'A Rust-based embedded controller for home automation, running on Raspberry Pi.',
        technologies: ['Rust', 'MQTT', 'Raspberry Pi', 'React'],
        image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=400&fit=crop',
        link: '#',
        type: 'Project'
      }
    ],
    achievements: [
      { id: 'ach_alex_1', title: 'Open Source Contributor', description: 'Merged 10 PRs into embedded Rust projects', icon: '🦀', date: 'Apr 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Posted about Rust & ML integration', icon: '🦀', time: '2 days ago', link: '#' },
      { type: 'join', text: 'Joined AI/ML Enthusiasts', icon: '🎉', time: '2 months ago', link: '/communities/aiml' }
    ],
    socialLinks: {},
    communitiesJoined: 2,
    eventsAttended: 4,
    connectionsMade: 8,
    projectsShared: 0,
    postsThisMonth: 1,
    profileVisitsThisWeek: 5,
    newConnectionsThisWeek: 0,
    recentlyActive: false,
    memberSince: 'Jun 2024'
  },
  chrisb: {
    id: 'u6',
    username: 'chrisb',
    displayName: 'Chris B.',
    avatar: 'C',
    avatarUrl: null,
    bio: 'Design system advocate & PM. Building bridges between design and engineering teams.',
    location: 'Toronto, CA',
    role: 'Product Manager',
    email: 'chrisb@meetify.app',
    followers: 3400,
    following: 200,
    communities: ['Design Buddies', 'IIT Delhi', 'Startup Hub'],
    course: 'BBA',
    year: '3rd Year',
    collegeId: 'iitdelhi',
    verified: false,
    interests: ['Product Management', 'Design Systems', 'Agile', 'User Research'],
    skills: ['Jira', 'Figma', 'Analytics', 'A/B Testing', 'Roadmapping'],
    projects: [
      {
        id: 'proj_chris_1',
        title: 'DesignOps Playbook',
        description: 'An open-source guide for scaling design systems across large product teams.',
        technologies: ['Figma', 'Notion', 'Storybook'],
        image: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=600&h=400&fit=crop',
        link: '#',
        type: 'Resource'
      }
    ],
    achievements: [
      { id: 'ach_chris_1', title: 'Product Lead', description: 'Led product launch for a 0-to-1 SaaS tool with 500 beta users', icon: '🚀', date: 'May 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Shared DesignOps playbook', icon: '📋', time: '1 week ago', link: '#' },
      { type: 'join', text: 'Joined Design Buddies', icon: '🎉', time: '3 months ago', link: '/communities/design' }
    ],
    socialLinks: {
      linkedin: 'https://linkedin.com/in/chrisb'
    },
    communitiesJoined: 3,
    eventsAttended: 6,
    connectionsMade: 32,
    projectsShared: 0,
    postsThisMonth: 2,
    profileVisitsThisWeek: 18,
    newConnectionsThisWeek: 1,
    recentlyActive: false,
    memberSince: 'Apr 2024'
  },
  johnsonw: {
    id: 'u7',
    username: 'johnsonw',
    displayName: 'Johnson Wood',
    avatar: 'J',
    bio: 'Tech enthusiast & gamer. Exploring web3 and game dev.',
    location: 'Seattle, WA',
    role: 'Game Developer',
    email: 'johnson@meetify.app',
    followers: 1450,
    following: 210,
    communities: ['Hackathon Heroes', 'Gaming & E-Sports', 'GLA University'],
    course: 'B.Sc Gaming',
    year: '2nd Year',
    collegeId: 'gla',
    verified: false,
    interests: ['Game Development', 'Web3', 'Unity', 'Unreal Engine', 'Pixel Art'],
    skills: ['Unity', 'C#', 'Blender', 'Unreal Engine', 'Solidity'],
    projects: [
      {
        id: 'proj_5',
        title: 'Pixel Quest',
        description: 'A 2D platformer built in Unity with procedurally generated levels.',
        technologies: ['Unity', 'C#', 'Aseprite'],
        image: 'https://images.unsplash.com/photo-1551103782-8ab07afd45c1?w=600&h=400&fit=crop',
        link: '#',
        type: 'Game'
      }
    ],
    achievements: [
      { id: 'ach_7', title: 'Game Jam Winner', description: 'Won Global Game Jam 2025', icon: '🎮', date: 'Jan 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Looking for 3D artist for game jam', icon: '🎮', time: '3 days ago', link: '#' }
    ],
    socialLinks: {
      github: 'https://github.com/johnsonw',
      website: 'https://johnsonw.dev'
    },
    communitiesJoined: 3,
    eventsAttended: 7,
    connectionsMade: 22,
    projectsShared: 2,
    postsThisMonth: 4,
    profileVisitsThisWeek: 15,
    newConnectionsThisWeek: 2,
    recentlyActive: true,
    memberSince: 'May 2024'
  },
  sarahj: {
    id: 'u8',
    username: 'sarahj',
    displayName: 'Sarah Jones',
    avatar: 'S',
    avatarUrl: null,
    bio: 'Backend wizard. Rust ace. Contributor to open-source distributed systems projects.',
    location: 'Berlin, DE',
    role: 'Backend Engineer',
    email: 'sarahj@meetify.app',
    followers: 4300,
    following: 120,
    communities: ['Startup Hub', 'IIT Delhi', 'Hackathon Heroes'],
    course: 'M.Tech CSE',
    year: '2nd Year',
    collegeId: 'iitdelhi',
    verified: false,
    interests: ['Backend', 'Rust', 'Systems Programming', 'Distributed Systems'],
    skills: ['Rust', 'Go', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes'],
    projects: [
      {
        id: 'proj_sarah_1',
        title: 'RustDB',
        description: 'A lightweight key-value store written in Rust, inspired by Redis.',
        technologies: ['Rust', 'Tokio', 'RESP Protocol'],
        image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&h=400&fit=crop',
        link: '#',
        type: 'Open Source'
      }
    ],
    achievements: [
      { id: 'ach_sarah_1', title: 'Distributed Systems Award', description: 'Contributed a critical fix to a major open-source project', icon: '🔧', date: 'Mar 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Shared Rust library for ML inference', icon: '🦀', time: '4 hours ago', link: '#' },
      { type: 'milestone', text: 'Hit 4K followers', icon: '🌟', time: '2 weeks ago', link: '#' },
      { type: 'join', text: 'Joined Hackathon Heroes', icon: '🎉', time: '4 months ago', link: '/communities/hackathon' }
    ],
    socialLinks: {
      github: 'https://github.com/sarahj'
    },
    communitiesJoined: 3,
    eventsAttended: 9,
    connectionsMade: 40,
    projectsShared: 1,
    postsThisMonth: 2,
    profileVisitsThisWeek: 22,
    newConnectionsThisWeek: 0,
    recentlyActive: false,
    memberSince: 'Sep 2023'
  },
  student: {
    id: 'u9',
    username: 'student',
    password: 'gla123',
    displayName: 'GLA Student',
    avatar: 'S',
    avatarUrl: null,
    bio: 'Student at GLA University.',
    location: 'Mathura, India',
    role: 'Student',
    email: 'student@gla.ac.in',
    followers: 12,
    following: 34,
    communities: ['GLA University'],
    course: 'B.Tech CS',
    year: '1st Year',
    collegeId: 'gla',
    verified: true,
    interests: ['Programming', 'Technology'],
    skills: ['C++', 'Python', 'Web Dev'],
    projects: [],
    achievements: [],
    activityLog: [],
    socialLinks: {},
    communitiesJoined: 1,
    eventsAttended: 0,
    connectionsMade: 5,
    projectsShared: 0,
    postsThisMonth: 0,
    profileVisitsThisWeek: 2,
    newConnectionsThisWeek: 1,
    recentlyActive: true,
    memberSince: 'Jun 2026'
  }
};

export const initialPosts = [
  { 
    id: 'f_main_1', 
    authorId: 'u1', 
    time: '2 hours ago', 
    text: 'Just finished an amazing hackathon! Built a real-time collab tool with 3 new friends I met here. Meetify is the best place to find your tribe 🚀', 
    likes: 24, 
    comments: 8,
    replies: [
      {
        id: 'r1',
        authorId: 'u4',
        time: '1 hour ago',
        text: 'Totally agree with this! The transition to glassmorphism is making things look so much cleaner.',
        likes: 5,
        isLikedByMe: false,
        replies: [
          {
            id: 'r1_1',
            authorId: 'u5',
            time: '45 mins ago',
            text: 'I think neumorphism still has its place, especially for hardware-like interfaces, but glassmorphism is definitely more modern.',
            likes: 2,
            isLikedByMe: false,
            replies: []
          }
        ]
      },
      {
        id: 'r3',
        authorId: 'u6',
        time: '20 mins ago',
        text: 'Can you share the Figma file? Would love to see how you set up the layer blurs!',
        likes: 8,
        isLikedByMe: false,
        replies: []
      }
    ]
  },
  { 
    id: 'f_main_2', 
    authorId: 'u2', 
    time: '5 hours ago', 
    text: "Looking for a UI/UX designer to join my startup project. We're building a mental-wellness app. DM me if interested! ✨", 
    likes: 18, 
    comments: 12,
    replies: []
  },
  { 
    id: 'f_main_3', 
    authorId: 'u3', 
    time: 'Yesterday', 
    text: 'Hosting a virtual coffee chat this Saturday at 4PM EST. Topic: "Breaking into AI/ML as a self-taught dev." All welcome — link in bio! ☕', 
    likes: 42, 
    comments: 15,
    replies: []
  },
  { 
    id: 'f_main_4', 
    authorId: 'u4', 
    time: '2 days ago', 
    text: 'Just deployed my first portfolio built entirely with React and Three.js! The 3D interactions are so much fun to build. Check it out guys! 🌍', 
    likes: 89, 
    comments: 24,
    replies: []
  },
  { 
    id: 'f_main_5', 
    authorId: 'u7', 
    time: '3 days ago', 
    text: 'Is anyone here participating in the Global Game Jam next month? I need a 3D artist to complete our team!', 
    likes: 12, 
    comments: 5,
    replies: []
  },
  { 
    id: 'f_main_6', 
    authorId: 'u1', 
    time: '4 days ago', 
    text: 'Experimenting with some new WebGL shaders today. The math is hurting my brain but the visual results are so worth it! 🧠✨', 
    likes: 112, 
    comments: 18,
    replies: []
  },
  { 
    id: 'f_main_7', 
    authorId: 'u1', 
    time: '1 week ago', 
    text: 'Hot take: Next.js app router is actually really good once you get past the initial learning curve and stop trying to use it like the pages router.', 
    likes: 340, 
    comments: 89,
    replies: []
  },
  { 
    id: 'f_main_8', 
    authorId: 'u2', 
    time: '2 weeks ago', 
    text: 'Accessibility isn\'t a feature you add at the end of a project. It\'s a foundation you build upon. Start with semantic HTML!', 
    likes: 245, 
    comments: 31,
    replies: []
  },
  { 
    id: 'f_main_9', 
    authorId: 'u1', 
    time: '3 weeks ago', 
    text: 'Can we agree that standardizing design tokens is the best thing to happen to frontend development in the last 5 years?', 
    likes: 840, 
    comments: 112,
    replies: []
  },
  { 
    id: 'f_main_10', 
    authorId: 'u1', 
    time: '1 month ago', 
    text: 'Just read an amazing article on CSS Grid subgrid. It solves so many complex layout problems we used to need Javascript for.', 
    likes: 120, 
    comments: 24,
    replies: []
  },
  { 
    id: 'f_main_11', 
    authorId: 'u1', 
    time: '1 month ago', 
    text: 'Imposter syndrome never really goes away, you just get better at recognizing it and telling it to shut up. Keep building, everyone.', 
    likes: 924, 
    comments: 65,
    replies: []
  },
  { 
    id: 'f_main_12', 
    authorId: 'u1', 
    time: '2 months ago', 
    text: 'Who else is excited for the new React compiler? Memoization out of the box sounds like a dream come true.', 
    likes: 450, 
    comments: 89,
    replies: []
  },
  { 
    id: 'f_main_13', 
    authorId: 'u1', 
    time: '2 months ago', 
    text: 'Finished migrating a legacy project to Vite today. Build times went from 45 seconds to 2 seconds. Incredible.', 
    likes: 310, 
    comments: 15,
    replies: []
  },
];