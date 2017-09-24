import fs from 'fs';
import FeedParser from 'feedparser';
import parse5 from 'parse5';
import request from 'request';
import leven from 'leven';
import stopwords from 'stopwords';
import {Client} from 'elasticsearch';
import {
  index, 
  searchTerms, 
  spamTerms, 
  cleanLinks, 
  htmlLinks,
  esHost,
  esPort,
  operations,
} from '../config';
import {AWSUploader} from './uploader';

console.log('Connecting to elasticsearch host', esHost);

const client = new Client({host: { host: esHost, port: esPort }, log: 'error',});

/** 
 * Construct the components of an elasticsearch bulk request for a single document
 */
const mkIndexRequest = (body) => [{ index: {
  // Index request parameters
    _index: index,
    _type: 'flashentry',
    _id: body.redirectionUrl,
  }},
  body
];

/** Extract/rename parsed RSS data */
function extractItem({pubDate, link: redirectionUrl, guid: uid, title: titleText, summary: mainText}) {
  const updateDate = new Date(pubDate);
  const nonAscii = /[^\x00-\x7F]/g;
  titleText = titleText.replace(nonAscii, '');
  mainText = mainText.replace(nonAscii, '');
  return {uid, updateDate, titleText, mainText, redirectionUrl};
}

/** Get documents from RSS url */
function readRSS(url) {
  const req = request(url);
  const feedparser = new FeedParser();
  return new Promise(resolve => {
    req.on('error', err => {
      console.error('Failed to load feed', url);
      throw err;
    });
    req.on('response', function (response) {
      console.log('Loading feed', url);
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

/**
 * Log and return object
 */
function passthroughLog(obj) {
  console.log(obj);
  return obj;
}

/** Load and clean RSS data */
function loadLinks() {
  const cleanedHtmlPromise = htmlLinks.map(readRSS).map(promise => promise.then(rssItems => rssItems.map(stripHtml)));
  const loadedData = Promise.all(cleanLinks.map(readRSS).concat(cleanedHtmlPromise))
    .then(allLinks => allLinks.map(links => links.map(extractItem)))
    // Flatten
    .then(allLinks => allLinks.reduce((a, b) => a.concat(b), []))
    .then(flatLinks => flatLinks.filter(({updateDate}) => updateDate))
  return loadedData.then(flatLinks => flatLinks.map(mkIndexRequest))
    // Re-flatten
    .then(requestElems => requestElems.reduce((a,b) => a.concat(b), []))
    .then(body => client.bulk({body}))
  //return loadedData.then(flatLinks => Promise.all(flatLinks.map(indexNews)));
}

/** Delete the elasticsearch index (and its contents) */
function deleteIndex() {
  client.indices.delete({index});
}

/** Searches elasticsearch for the best news according to query */
function getBestNews() {
  const size = 30; // Number of results to return
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
    weight: .001,
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
        score_mode: 'multiply',
        boost_mode: 'multiply',
        functions,
      },
    },
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
    .then(({hits: {hits}}) => hits)
    .then(hits => hits.map(({_source}) => _source));
}

function addToArrayMap(key, val, arrayMap) {
  if(arrayMap[key]) {
    arrayMap[key].push(val);
  } else {
    arrayMap[key] = [val];
  }
  return arrayMap;
}

const clean = (string) => string.toLowerCase().replace(/[',\/=0-9\(\)\.:@|-]/g, '').replace(/  /g, ' ').trim()

// Maximum allowable bigram overlap
const OVERLAP_THRESHOLD = 1;
/**
 * Try to eliminate articles that are about the same thing
 * 
 * Gives priority to articles with lower array indices
 */
function filterSimilar(articles) {
  const compareElems = ['titleText', 'mainText'];
  function extractText(article) {
    return compareElems.map(elem => article[elem]).reduce((a,b) => a + b);
  }
  const stopWords = new Set(stopwords.english);
  function tokenize(string) {
    return string
      .split(/\s/)
      .filter(elem => elem.length > 0)
      .map(elem => elem.toLowerCase())
      .filter(elem => stopWords.has(elem) === false);
  }
  function makeBigrams(tokens) {
    return tokens
      // Make bigrams from adjacent words
      .map((left, index) => tokens.slice(index + 1, index + 2).map(right => `${left}${right}`))
      .reduce((a, b) => a.concat(b), []);
  }
  function getBigramOverlaps(left, right) {
    const leftGrams = Array.from(new Set(makeBigrams(tokenize(left)))); //Dedup
    const rightGrams = new Set(makeBigrams(tokenize(right)));
    return leftGrams.filter(left => rightGrams.has(left));
  }
  const indicesToRemove = new Set();
  articles.forEach((article, index) => {
    if(indicesToRemove.has(index)) { return; }
    articles.slice(index + 1).forEach((other, otherRelIndex) => {
      const left = extractText(article);
      const right = extractText(other);
      const overlaps = getBigramOverlaps(left,right);
      if(overlaps.length > OVERLAP_THRESHOLD) {
        const otherAbsIndex = otherRelIndex + index + 1;
        indicesToRemove.add(otherAbsIndex);
      }
    });
  });
  return articles.filter((_, index) => indicesToRemove.has(index) === false);
}

function isNotSpammy({titleText, mainText}) {
  const badness = spamTerms.map(term => term.toLowerCase());
  const body = clean(`${titleText} ${mainText}`);
  return badness.every(spamTerm => body.indexOf(spamTerm) === -1);
}

const MAX_ARTICLES = 10;

/**
 * Reset index to configured mapping
 */
function configureIndex() {
  console.log('Reconfiguring index', index);
  return client.indices.exists({index})
    .then(exists => exists ? client.indices.delete({index}) : Promise.resolve('no existing'))
    .then(console.log)
    .then(() => client.indices.create({
      index,
      body: {
        mappings: {
          flashentry: {
            properties: {
              mainText: {
                type: 'text',
                fielddata: true,
              },
              titleText: { 
                type: 'text',
                fielddata: true,
              },
              redirectionUrl: { type: 'keyword' },
              uid: { type: 'keyword' },
              updateDate: { type: 'date' },
            },
          }
        },
      }
    }))
    .then(res => console.log('Index creation result', res));
}

function getOperations() {
  const FORMATINDEX='FORMATINDEX',
    FETCHNEWS='FETCHNEWS',
    PUBLISH='PUBLISH';
  const defaultOperations = {
    configIndex: false,
    loadLinks: false,
    getResults: false,
  };
  if(!operations) {
    throw 'No operation specified';
  }
  return operations.trim().split(/[,\s]/).filter(operation => operation.length > 0).reduce((ops, operation) => {
    switch(operation) {
      case FORMATINDEX:
        ops.configIndex = true;
        break;
      case FETCHNEWS:
        ops.loadLinks = true;
        break;
      case PUBLISH:
        ops.getResults = true;
        break;
      default:
        console.error('Unrecognized operation', operation);
        break;
    }
    return ops; 
  }, defaultOperations);
}

function execOrSkip(doExec, futureFunc) {
  if(doExec) {
    return futureFunc;
  }
  return () => Promise.resolve();
}

function addTitleToBody(article) {
  const {titleText, mainText} = article;
  article.mainText = `${titleText}: ${mainText}`;
  return article;
}

(function main() {
  const uploader = new AWSUploader();
  uploader.configure({});
  const operations = getOperations();
  console.log('operations', operations);
  const loaderPromise = Promise.resolve()
    .then(() => execOrSkip(operations.configIndex, configureIndex)())
    .then(() => execOrSkip(operations.loadLinks, loadLinks)())
    .catch((err) => console.error('Loaders failed', err));
  if(operations.getResults) {
    console.log('Publishing best results');
    loaderPromise
    .then(() => getBestNews())
    // Sort by recency
    .then(flatLinks => flatLinks.sort(({updateDate: dateA}, {updateDate: dateB}) => 
      (new Date(dateA)).getTime() - (new Date(dateB)).getTime()))
    .then(flatLinks => flatLinks.reverse())
    .then(flatLinks => flatLinks.filter(isNotSpammy))
    // Remove similar articles
    .then(filterSimilar)
    .then(flatLinks => flatLinks.slice(0, MAX_ARTICLES))
    .then(flatLinks => flatLinks.map(addTitleToBody))
    // Convert to JSON and save to S3
    .then(body => JSON.stringify(body, null, 2))
    .then(passthroughLog)
    .then(body => uploader.upload(body))
    .catch((err) => console.error('Publication failed', err));
  }
})();
