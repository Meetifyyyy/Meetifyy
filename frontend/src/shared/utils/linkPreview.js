export function getLinkPreview(text) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/;
  const match = text.match(urlRegex);
  if (!match) return null;

  const url = match[0];
  const cleanUrl = url.startsWith('www.') ? `https://${url}` : url;
  let site = '';
  try {
    site = new URL(cleanUrl).hostname.replace(/^www\./, '');
  } catch (e) {
    site = cleanUrl;
  }

  const siteLower = site.toLowerCase();

  // Exact host or true subdomain only. A substring test such as
  // `siteLower.includes('youtube.com')` also matches `youtube.com.attacker.io`,
  // which let a hostile link render with YouTube's title and artwork - a
  // ready-made phishing card inside the feed.
  const isHost = (domain) =>
    siteLower === domain || siteLower.endsWith(`.${domain}`);
  let title = '';
  let description = '';
  let image = '';

  if (isHost('youtube.com') || isHost('youtu.be')) {
    title = 'Watch this on YouTube';
    description = 'Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube.';
    image = 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-5.webp';
  } else if (isHost('github.com')) {
    title = 'GitHub: Let’s build from here';
    description = 'GitHub is where over 100 million developers shape the future of software, together. Host and review code, manage projects, and build software.';
    image = 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-coding-img-code-4.webp';
  } else if (isHost('dribbble.com')) {
    title = 'Dribbble - Discover the World’s Top Designers';
    description = 'Find Top Designers & Creative Professionals on Dribbble. We are where designers gain inspiration, feedback, community, and jobs.';
    image = 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-coding-img-code-5.webp';
  } else if (isHost('martinfowler.com')) {
    title = 'Martin Fowler — Patterns of Enterprise Application Architecture';
    description = 'A guide to writing software architecture, agile methodology, and design patterns by Martin Fowler and guest authors.';
    image = 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-coding-img-code-1.webp';
  } else if (isHost('speakerdeck.com')) {
    title = 'Speaker Deck — Share Your Presentations Online';
    description = 'Speaker Deck is the best way to share slides online. Simply upload a PDF, and we will turn it into a beautiful, shareable deck.';
    image = 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-coding-img-code-6.webp';
  } else if (isHost('twitter.com') || isHost('x.com')) {
    title = 'X. It’s what’s happening';
    description = 'From breaking news and entertainment to sports and politics, get the full story with all the live commentary.';
    image = 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/presets/images/preset-image-party-img-party-4.webp';
  } else {
    return null;
  }

  return {
    url: cleanUrl,
    site,
    title,
    description,
    image
  };
}

export function cleanUrlDisplay(urlStr) {
  if (!urlStr) return '';
  try {
    const hasProtocol = /^https?:\/\//i.test(urlStr);
    const parsed = new URL(hasProtocol ? urlStr : `https://${urlStr}`);
    let host = parsed.hostname;
    if (host.startsWith('www.')) host = host.substring(4);
    let path = parsed.pathname;
    if (path === '/') path = '';
    
    // Strip trailing slash
    if (path.endsWith('/')) path = path.slice(0, -1);
    
    return `${host}${path}`;
  } catch (e) {
    let cleaned = urlStr.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    const qIdx = cleaned.indexOf('?');
    if (qIdx !== -1) cleaned = cleaned.substring(0, qIdx);
    if (cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1);
    return cleaned;
  }
}

