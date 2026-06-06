export const initialUsers = {
  alicechen: {
    id: 'u1',
    username: 'alicechen',
    displayName: 'Alice Chen',
    avatar: 'A',
    bio: 'Building cool stuff & meeting awesome people. I love experimenting with new technologies, creating unique user experiences, and exploring the unknown.',
    location: 'Based in New York',
    role: 'Full-stack Developer',
    email: 'alicechen@meetify.app',
    followers: 8401,
    following: 161,
    communities: ['Startup Hub', 'Hackathon Heroes']
  },
  marcusrivera: {
    id: 'u2',
    username: 'marcusrivera',
    displayName: 'Marcus Rivera',
    avatar: 'M',
    bio: 'Product Designer focused on mental wellness and accessible UX. Always looking for new challenges.',
    location: 'San Francisco, CA',
    role: 'UI/UX Designer',
    email: 'marcus@meetify.app',
    followers: 5230,
    following: 340,
    communities: ['Design Thinkers']
  },
  priyasharma: {
    id: 'u3',
    username: 'priyasharma',
    displayName: 'Priya Sharma',
    avatar: 'P',
    bio: 'Self-taught ML Engineer. Passionate about democratizing AI education.',
    location: 'Remote',
    role: 'ML Engineer',
    email: 'priya@meetify.app',
    followers: 12500,
    following: 50,
    communities: ['AI Innovators']
  },
  sammydoe: {
    id: 'u4',
    username: 'sammydoe',
    displayName: 'Sammy Doe',
    avatar: 'S',
    bio: 'Frontend enthusiast. Glassmorphism is the future.',
    location: 'London, UK',
    role: 'Frontend Dev',
    email: 'sammy@meetify.app',
    followers: 1200,
    following: 400,
    communities: ['Frontend Masters']
  },
  alexq: {
    id: 'u5',
    username: 'alexq',
    displayName: 'Alex Q.',
    avatar: 'A',
    bio: 'Hardware engineer turning software.',
    location: 'Austin, TX',
    role: 'Software Engineer',
    email: 'alexq@meetify.app',
    followers: 890,
    following: 120,
    communities: []
  },
  chrisb: {
    id: 'u6',
    username: 'chrisb',
    displayName: 'Chris B.',
    avatar: 'C',
    bio: 'Design system advocate.',
    location: 'Toronto, CA',
    role: 'Product Manager',
    email: 'chrisb@meetify.app',
    followers: 3400,
    following: 200,
    communities: ['Design Thinkers']
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
    communities: ['Hackathon Heroes', 'Gaming']
  },
  sarahj: {
    id: 'u8',
    username: 'sarahj',
    displayName: 'Sarah Jones',
    avatar: 'S',
    bio: 'Backend wizard. Rust ace.',
    location: 'Berlin, DE',
    role: 'Backend Engineer',
    email: 'sarahj@meetify.app',
    followers: 4300,
    following: 120,
    communities: ['Startup Hub']
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
