import fs from 'fs';
import FeedParser from 'feedparser';
import parse5 from 'parse5';
import nlp from 'compromise';
import natural from 'natural';
import Jaccard from 'jaccard-index';
import stringSimilarity from 'string-similarity';
import request from 'request';
import {Client} from 'elasticsearch';
import {
  index, 
  searchTerms, 
  spamTerms, 
  cleanLinks, 
  htmlLinks,
  esHost,
} from '../config';
import {AWSUploader} from './uploader';

console.log('Connecting to elasticsearch host', esHost);

const client = new Client({host: { host: esHost, port: 9200 }, log: 'error',});


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
function extractItem({date, link: redirectionUrl, guid: uid, title: titleText, summary: mainText}) {
  const updateDate = new Date(date);
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
  const size = 100; // Number of results to return
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

function addToArrayMap(key, val, arrayMap) {
  if(arrayMap[key]) {
    arrayMap[key].push(val);
  } else {
    arrayMap[key] = [val];
  }
  return arrayMap;
}

const clean = (string) => string.toLowerCase().replace(/[',\/=0-9\(\)\.:@|-]/g, '').replace(/  /g, ' ').trim()


/**
 * Try to eliminate articles that are about the same thing
 * 
 * Gives priority to articles with lower array indices
 */
function filterSimilar(articles) {
  const jaccardThreshold = 0.1;
  const jaccard = Jaccard();
  const searchElem = 'mainText';

  // Extract topic words
  const topics = articles
    .map(article => clean(nlp(article[searchElem]).nouns().out()))
    .map(topic => topic.split(' ').map(word => natural.PorterStemmer.stem(word)).join(' '));

  // Build TF/IDF database
  const tfidf = new natural.TfIdf();
  topics.forEach(topic => tfidf.addDocument(topic));

  const commonTerms = new Set(searchTerms.map(term => clean(term)));
  const topK = 8;
  const importantTerms = tfidf.documents
    .map((_,index) => tfidf.listTerms(index).map(({term}) => term).slice(0, topK))
    .map(terms => {
      return terms.filter(term => commonTerms.has(term) === false)
    });
  const indicesToRemove = new Set();
  for(var i = 0; i + 1 < importantTerms.length; i++) {
    let toCompare = importantTerms.slice(i + 1);
    let left = importantTerms[i];
    toCompare.forEach((right, relIndex) => {
        if(jaccard.index(left, right) > jaccardThreshold) {
          let absIndex = relIndex + i;
          indicesToRemove.add(absIndex);
        }
      })
  }

  return articles.filter((_, index) => indicesToRemove.has(index) === false);
}

function isNotSpammy({titleText, mainText}) {
  const badness = spamTerms.map(term => term.toLowerCase());
  const body = clean(`${titleText} ${mainText}`);
  return badness.every(spamTerm => body.indexOf(spamTerm) === -1);
}

const MAX_ARTICLES = 10;

(function main() {
  const uploader = new AWSUploader();
  uploader.configure({});
  Promise.resolve()
    //.then(() => client.ping().then(console.log))
    //.then(() => loadLinks())
    //.then(() => client.indices.flushSynced())
    .then(() => getBestNews())
    // Sort by recency
    .then(flatLinks => flatLinks.sort(({updateDate: dateA}, {updateDate: dateB}) => (new Date(dateA)).getTime() - (new Date(dateB)).getTime()))
    .then(flatLinks => flatLinks.reverse())
    .then(flatLinks => flatLinks.filter(isNotSpammy))
    // Remove similar articles
    .then(filterSimilar)
    .then(flatLinks => flatLinks.slice(0, MAX_ARTICLES))
    // Convert to JSON and save to S3
    .then(body => JSON.stringify(body, null, 2))
    .then(body => uploader.upload(body))
    .then(console.log)
    .catch((err) => console.error('Generation failed', err));
})();
