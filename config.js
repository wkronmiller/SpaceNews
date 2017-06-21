// Terms to look for
export const searchTerms =['space', 'SLS', 'satellite', 'launch', 'planet', 'star'];
// Terms to avoid
export const spamTerms = ['find out', 'students', '12 reasons', 'star trek'];

// Links that have plain text RSS summaries
export const cleanLinks = [
  'https://www.nasa.gov/rss/dyn/breaking_news.rss',
  'https://www.space.com/home/feed/site.xml',
  'http://spectrum.ieee.org/rss/aerospace/fulltext',
  'https://www.sciencedaily.com/rss/space_time.xml',
];

// Links that embed HTML fragments into their RSS summaries
export const htmlLinks = [
  'https://aviationweek.com/rss.xml',
  'http://feeds.reuters.com/reuters/technologyNews',
  'http://feeds.reuters.com/reuters/topNews',
  'http://feeds.reuters.com/reuters/scienceNews',
  'http://spacenews.com/feed/',
];
