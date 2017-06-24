// Hostname of exlasticsearch server
export const esHost = process.env.ES_HOSTNAME || 'http://localhost:9200'; 
// Terms to look for
export const searchTerms = (process.env.SEARCH_TERMS || '*').split(',');
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
  'https://www.theatlantic.com/feed/all/',
];

// Name of elasticsearch index used
export const index = process.env.ES_INDEX || 'newsindex';

// S3 Upload Parameters
export const bucketName = process.env.BUCKET_NAME;
export const bucketKey = process.env.BUCKET_KEY;
