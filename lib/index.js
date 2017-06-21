import fs from 'fs';
import FeedParser from 'feedparser';
import parse5 from 'parse5';
import request from 'request';
import {Client} from 'elasticsearch';

// Terms to look for
const searchTerms =['space', 'SLS', 'satellite', 'launch', 'planet', 'star'];
// Terms to avoid
const spamTerms = ['find out', 'students', '12 reasons', 'star trek'];

// Links that have plain text RSS summaries
const cleanLinks = [
  'https://www.nasa.gov/rss/dyn/breaking_news.rss',
  'https://www.space.com/home/feed/site.xml',
  'http://spectrum.ieee.org/rss/aerospace/fulltext',
  'https://www.sciencedaily.com/rss/space_time.xml',
];

// Links that embed HTML fragments into their RSS summaries
const htmlLinks = [
  'https://aviationweek.com/rss.xml',
  'http://feeds.reuters.com/reuters/technologyNews',
  'http://feeds.reuters.com/reuters/topNews',
  'http://feeds.reuters.com/reuters/scienceNews',
  'http://spacenews.com/feed/',
];

const client = new Client({host: 'localhost:9200', log: 'error', httpAuth: 'elastic:changeme'});

const index = 'spacenews';

/** Add a document to the elasticsearch index */
const indexNews = (body) => client.index({
  index,
  type: 'flashentry',
  id: body.redirectionUrl,
  body,
});

/** Extract/rename parsed RSS data */
function extractItem({date, link: redirectionUrl, guid: uid, title: titleText, summary: mainText}) {
  const updateDate = new Date(date);
  return {uid, updateDate, titleText, mainText, redirectionUrl};
}

/** Get documents from RSS url */
function readRSS(url) {
  const req = request(url);
  const feedparser = new FeedParser();
  return new Promise(resolve => {
    req.on('error', err => {throw err;});
    req.on('response', function (response) {
      this.pipe(feedparser);
    });
    var buffer = [];
    feedparser.on('readable', function() {
      var item;
      while(item = this.read()) {
        buffer.push(item);
      }
    });
    feedparser.on('end', () => resolve(buffer));
  });
}

/** Helper function to walk HTML fragment AST. Used by stripHtml */
function getValuesFromNode(node) {
  const {childNodes, value} = node;
  if(childNodes) {
    return [value].concat(childNodes.map(getValuesFromNode))
      .filter(val => val)
      .reduce((a,b) => a.concat(b), []);
  }
  return [value];
}

/** Special function to strip HTML tags from returned document */
function stripHtml(rawRss) {
  const fragment = parse5.parseFragment(rawRss.summary);
  rawRss.summary = getValuesFromNode(fragment).join(' ').replace(/[^\S ]+/mg, '').replace(/\s+/g, ' ');
  return rawRss;
}

/** Load and clean RSS data */
function loadLinks() {
  const cleanedHtmlPromise = htmlLinks.map(readRSS).map(promise => promise.then(rssItems => rssItems.map(stripHtml)));
  const loadedData = Promise.all(cleanLinks.map(readRSS).concat(cleanedHtmlPromise))
    .then(allLinks => allLinks.map(links => links.map(extractItem)))
    // Flatten
    .then(allLinks => allLinks.reduce((a, b) => a.concat(b), []))
    .then(flatLinks => flatLinks.filter(({updateDate}) => updateDate))
  return loadedData.then(flatLinks => Promise.all(flatLinks.map(indexNews)));
}

/** Delete the elasticsearch index (and its contents) */
function deleteIndex() {
  client.indices.delete({index});
}

/** Searches elasticsearch for the best news according to query */
function getBestNews() {
  const size = 20; // Number of results to return
  // Give priority to more recent articles
  const dateFunction = {
    weight: 5,
    gauss: {
      updateDate: {
        origin: new Date(),
        scale: '3d',
        decay: 0.5  
      },
    },
  };
  // Give lower priority to articles with spammy terms
  const spamFunctions = spamTerms.map(term => ({
    filter: { match: { _any: `"${term}"` } },
    weight: .01,
  }));
  const functions = [dateFunction].concat(spamFunctions);
  const body = {
    query: {
      function_score: {
        query: {
          query_string: {
            default_field: 'mainText',
            query: searchTerms.join(' OR ')
          },
        },
        score_mode: 'sum',
        boost_mode: 'multiply',
        functions,
      },
    }
  };
  const searchParams = {
    index,
    body,
    size,
  };
  return client
    .search(searchParams)
    .then(results => {
      // Log raw results to json for debugging/tuning
      fs.writeFile('rawResults.json', JSON.stringify(results, null, 2), () => {});
      return results;
    })
    .then(({hits}) => hits.hits)
    .then(hits => hits.map(({_source}) => _source));
}

(function main() {
  Promise.resolve()
    .then(() => loadLinks())
    .then(() => client.indices.flushSynced())
    .then(() => getBestNews())
    .then(flatLinks => flatLinks.sort(({updateDate: dateA}, {updateDate: dateB}) => (new Date(dateA)).getTime() - (new Date(dateB)).getTime()))
    .then(flatLinks => flatLinks.reverse())
    .then(body => JSON.stringify(body, null, 2))
    .then(body => fs.writeFileSync('output.json', body))
    .catch((err) => console.error('Generation failed', err));
})();
