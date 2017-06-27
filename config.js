module.exports = {
// Hostname of exlasticsearch server
esHost: process.env.ES_HOSTNAME,
// Terms to look for
searchTerms : process.env.SEARCH_TERMS.split(','),
// Terms to avoid
spamTerms : [
  'find out', 
  'students', 
  '12 reasons', 
  'calendar',
  'episode',
  'star trek',
  'cover image',
  'most amazing',
],

// Links that have plain text RSS summaries
cleanLinks : [
  'https://www.nasa.gov/rss/dyn/breaking_news.rss',
  'https://www.space.com/home/feed/site.xml',
  'http://spectrum.ieee.org/rss/aerospace/fulltext',
  'https://www.sciencedaily.com/rss/space_time.xml',
],

// Links that embed HTML fragments into their RSS summaries
htmlLinks : [
  'https://aviationweek.com/rss.xml',
  'http://feeds.reuters.com/reuters/technologyNews',
  'http://feeds.reuters.com/reuters/topNews',
  'http://feeds.reuters.com/reuters/scienceNews',
  'http://spacenews.com/feed/',
  'https://www.theatlantic.com/feed/all/',
],

// Name of elasticsearch index used
index : process.env.ES_INDEX,

// S3 Upload Parameters
bucketName : process.env.BUCKET_NAME,
bucketKey : process.env.BUCKET_KEY,
// What this instance is doing - FORMATINDEX,FETCHNEWS,PUBLISH
operations: process.env.OPERATIONS,
};
