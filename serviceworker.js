/**
 * Pattern for detecting markdown resource requests.
 * @type {RegExp}
 */
const MARKDOWN_MATCHER = /\.md$/i;

/**
 * Pattern for detecting front-matter.
 */
const FRONT_MATTER_MATCHER = /^---/;

/**
 * Name of the cache for htmlified markdown resources.
 * @type {string}
 */
const CACHE = 'markdown-cache';

importScripts(
    'https://unpkg.com/commonmark@0.30.0/dist/commonmark.js'
    );

if (!commonmark) throw 'Markdown parser failed to install.';

self.addEventListener('install', function(event) {
    // The promise that skipWaiting() returns can be safely ignored.
    self.skipWaiting();

    // Perform any other actions required for your
    // service worker to install, potentially inside
    // of event.waitUntil();
});

self.addEventListener('fetch', function(event) {
    if (MARKDOWN_MATCHER.test(event.request.url)) {
        event.respondWith(
            handler({ url: event.request.url, event, params: null})
        );
    }
});

/**
 * Handler for markdown resource requests.
 * This implementation is quite similar to workbox - https://github.com/GoogleChrome/workbox
 *
 * @async
 * @param url
 * @param event
 * @param params
 * @returns {Response}
 */
function handler({ url, event, params }) {
    let request = event.request;
    let isNavigating = event.request.mode == 'navigate';
    let isReloading = isNavigating && event.request.referrer === event.request.url;

    // This used to use Workbox with the CacheFirst strategy (or NetworkFirst when *reloading*)
    // and **something like** the following as a plugin for the strategy.
    let plugin = {
        requestWillFetch: ({request}) => {
            // Return `request` or a different Request
            console.debug('requestWillFetch', request);
            let headers = new Headers(request.headers);
            headers.set('Accept', 'text/markdown');
            request = new Request(request.url, {
                cache: 'reload',
                headers
            });
            return request;
        },
        cacheWillUpdate: ({request, response}) => {
            console.debug('cacheWillUpdate', response);
            return response.text()
                .then((text) => {
                    let inferredResponse = extractFrontMatter(text);
                    let html = transcode(inferredResponse.text);
                    html = htmlifyWithMetadata(html, inferredResponse.metadata, url);
                    let links = extractLinksFromHeaders(response.headers);
                    return resolveLinkedLinks(links, url)
                        .then((linkedLinks) => {
                            let headers = new Headers(response.headers);
                            linkedLinks.forEach((link) => {
                                headers.append('Link', `<${link.href}>` +
                                    (link.rel ? `; rel="${link.rel}"` : ``) +
                                    (link.as ? `; as="${link.as}"` : ``) +
                                    (link.type ? `; type="${link.type}"` : ``));
                            });
                            if (linkedLinks.length == 1 && linkedLinks[0].rel === 'shell') {
                                let shellUrl = linkedLinks[0].href;
                                headers.set('Shell', shellUrl)
                            }
                            headers.set('Content-Type', 'text/html');
                            headers.set('Content-Length', html.length);
                            let cacheableResponse = new Response(html, {
                                headers
                            });
                            return cacheableResponse;
                        });
                });
        },
        cacheDidUpdate: ({cacheName, request, oldResponse, newResponse}) => {
            console.debug('cacheDidUpdate', newResponse);
        },
        cachedResponseWillBeUsed({cacheName, request, matchOptions, cachedResponse}) {
            console.debug('cachedResponseWillBeUsed', cachedResponse);
            return cachedResponse.text()
                .then((content) => {
                    let links = extractLinksFromHeaders(cachedResponse.headers);
                    return getTemplate(request.mode === 'navigate' ? cachedResponse.headers.get('Shell') : null)
                        .then((template) => {
                            html = applyTemplate(template,
                                        content.match(/(?<=<main\b[^>]*>).*(?=<\/main>)/ims),
                                        content.match(/(?<=<head\b[^>]*>).*(?=<\/head>)/ims),
                                        links);
                            let headers = new Headers(cachedResponse.headers);
                            headers.set('Content-Length', html.length);
                            return new Response(html, {
                                headers
                            });
                        });
                });
        }
    };

    // We (effectively) use a cache-first strategy unless the user is reloading the page (Meta-R)
    // in which case we use network-first.
    // Network requests allow modifying the request ...
    // and also the network response before it is added to the cache.
    // In all cases the cached-response can be modified before it is used to fulfil the browser-context request.
    let cache;
    return caches.open(CACHE)
        .then((openedCache) => { // query the cache
            cache = openedCache;
            return cache.match(request);
        })
        .then((cachedResponse) => {
            return !isReloading && cachedResponse ?
                cachedResponse :
                fetch(plugin.requestWillFetch({request}))
                    .then((fetchedResponse) => {
                        return plugin.cacheWillUpdate({request, response: fetchedResponse});
                    })
                    .then((cacheableResponse) => {
                        cache.put(request, cacheableResponse.clone());
                        return cacheableResponse;
                    });
        })
        .then((cachedResponse) => {
            return plugin.cachedResponseWillBeUsed({cacheName: CACHE, request, matchOptions: null, cachedResponse});
        });
}

/**
 * Extract front-matter from Markdown text and return an object containing
 *   - the metadata as key-value
 *   - the remaining text
 *
 * @param text
 * @returns {{metadata: {}, text}}
 */
function extractFrontMatter(text)
{
    let metadata = {};
    let lineReader = new LineReader(text);
    let line = lineReader.readLine();
    if (FRONT_MATTER_MATCHER.test(line)) {
        let frontMatter = '';
        while (!FRONT_MATTER_MATCHER.test(line = lineReader.readLine())) {
            frontMatter += line;
            // FIXME trim leading spaces for multiline properties/
        }
        let props = frontMatter.split(/\n(?=\w)/m);
        props.forEach((prop) => {
            let colon = prop.search(':');
            let key = prop.substring(0, colon).trim();
            let value = prop.substring(colon + 1).trim().replace(/\s*s\n\s+/gm, '\n');
            metadata[key] = value;
        });

        text = lineReader.remainder();
    }

    return {
        metadata,
        text
    }
}

/**
 * Utility class for extractFrontMatter.
 */
class LineReader {
    NEW_LINE_REGEX = /\r\n|\n|\r/gm;
    startIndex = 0;
    text;

    constructor(text) {
        this.text = text;
    }

    readLine() {
        let result = this.NEW_LINE_REGEX.exec(this.text);
        if (result) {
            let lastIndex = this.NEW_LINE_REGEX.lastIndex;
            let line = this.text.substring(this.startIndex, lastIndex);
            this.startIndex = lastIndex;
            return line;
        }
        else {
            return null;
        }
    }

    remainder() {
        return this.text.substr(this.startIndex);
    }
}

/**
 * Convert markdown to html.
 *
 * @param markdown
 * @returns {string} the equivalent html (does not include <html>, <head>, <body>, etc).
 */
function transcode(markdown) {
    let reader = new commonmark.Parser();
    let writer = new commonmark.HtmlRenderer();
    let parsed = reader.parse(markdown); // parsed is a 'Node' tree
    return writer.render(parsed);
}

/**
 * Currently infers the document title as the text of the first heading element.
 *
 * @param html {string}
 * @param url {string} URL of the content. The pathname is used as a fallback.
 * @returns {string}
 */
function inferTitle(html, url) {
    let headerMatch = html.match(/<h[1-6](?:[^>]*)>(.*)<\/h[1-6]\b/);
    if (!headerMatch) return new URL(url).pathname;
    let innerHTML = headerMatch[1];
    let text = innerHTML.replace(/<\/?[^>]*>/g, '');
    return text;
}

/**
 * Extract a list of link descriptors from a response's headers
 *
 * @param headers
 * @returns {Array<Object>}
 */
function extractLinksFromHeaders(headers) {
    let linkHeader = headers.get('Link') || '';
    return linkHeader.split(/\s*,\s*/)
        .map((text) => {
            try {
                let params = text.split(/\s*;\s*/);
                let href = unquote(params.shift(), '<', '>', true);
                let link = {
                    href
                };
                params.forEach((param) => {
                    let entry = param.split(/\s*=\s*/);
                    let key = entry[0].toLowerCase();
                    let val = entry[1];
                    val = unquote(val, '\'', '\'', false);
                    val = unquote(val, '"', '"', false);
                    link[key] = val;
                });
                return link;
            } catch (ignored) {
                return null;
            }
        })
        .filter((link) => link != null);
}

/**
 * Currently extracts links from the `shell` array in the manifest file
 * but only if the manifest <link> has a @rel with "manifest" and "links"
 *
 * @async
 * @param links {Array}
 * @param url {string} the base-url for urls in links
 * @returns {Array}
 */
function resolveLinkedLinks(links, url) {
    let manifestLink = links.find((link) => /(^|\s)manifest(\s|$)/i.test(link.rel));
    if (manifestLink == null || !/(|\s)links(\s|$)/i.test(manifestLink.rel)) return Promise.resolve([]);

    let manifestUrl = resolveURL(manifestLink.href, url);
    return fetch(manifestUrl)
        .then((manifestResponse) => manifestResponse.json())
        .then((manifest) => extractLinksFromManifest(manifest, manifestUrl));
}

/**
 * Extract a list of resolved link descriptors from a manifest.
 * @param manifest {Object} from the manifest JSON file.
 * @param manifestUrl {string} the URL of the manifest.
 * @returns {Array<Object>}
 */
function extractLinksFromManifest(manifest, manifestUrl) {
    if (!manifest || !manifest.shell) return [];
    let links = manifest.shell; // FIXME should use a deep-clone.
    if (typeof links === 'string') {
        links = [{
            href: links,
            rel: 'shell',
            type: 'text/html'
        }];
    }
    links.forEach((link) => link.href = resolveURL(link.href, manifestUrl));
    return links;
}

/**
 * Merge variable content into an HTML template.
 * TODO: extract charset from network response and pass as an argument here.
 *
 * @param template
 * @param content
 * @param metadata
 * @param links {Array<Object>}
 * @returns {string}
 */
function applyTemplate(template, content, metadata, links) {
    let linksHtml = links.map((link) => {
        if (['text/javascript', 'application/javascript', 'module'].includes(link.type)) {
            return `<script src="${link.href}" type="${link.type}"></script>`;
        }
        return `<link` +
            (link.href ? ` href="${link.href}"` : ``) +
            (link.rel ? ` rel="${link.rel}"` : ``) +
            (link.as ? ` as="${link.as}"` : ``) +
            (link.type ? ` type="${link.type}"` : ``) +
            ` />`;
    }).join('\n');

    return template
        .replace(/(?<=<head\b[^>]*>)/ims, metadata)
        .replace(/(?=<\/head>)/ims, linksHtml)
        .replace(/(?<=<main\b[^>]*>).*(?=<\/main>)/ims, content);
}

/**
 * Retrieve the HTML template identified by supplied URL, or return the default template.
 *
 * @param shellUrl the HTML template URL.
 * @returns {string}
 */
function getTemplate(shellUrl) {
    if (shellUrl) {
        return fetchThroughCache(shellUrl)
            .then((response) => response.ok ? response.text() : getDefaultTemplate())
            .catch((err) => getDefaultTemplate());
    }
    return getDefaultTemplate();
}

function getDefaultTemplate() {
    return Promise.resolve(`
<!DOCTYPE html>
<html>
  <head>
    <title></title>
  </head>
  <body>
    <main></main>
  </body>
</html>
    `);
}

/**
 * Generate a document as HTML from a resources body-text and metadata.
 *
 * @param html
 * @param metadata
 * @returns {string}
 */
function htmlifyWithMetadata(html, metadata, url) {
    let title;
    let metadataList = [];
    Object.entries(metadata).forEach(([key, value]) => {
        if ('title' === key.toLowerCase()) title = value;
        else metadataList.push(`<meta name="${key}" content="${value}" />`);
    });

    if (!title) title = inferTitle(html, url);

    metadataList.push(`<title>${title}</title>`);

    let metaHtml = metadataList.join('\n');

    return `
<!DOCTYPE html>
<html>
<head>
${metaHtml}
</head>
<body>
<main>
${html}
</main>
</body>
</html>
    `;
}

/**
 * Request a url.
 * If it is in the cache then return that,
 * otherwise fetch from the network and add it to the cache (if fetch succeeds).
 * This is used for secondary resources - manifest, shell, etc.
 *
 * @param url
 * @returns {Response}
 */
function fetchThroughCache(url) {
    let request = new Request(url);
    return caches.open(CACHE)
        .then((cache) => {
            return cache.match(request)
                .then((cachedResponse) => {
                    return cachedResponse ? cachedResponse.clone() : fetch(request)
                        .then((response) => {
                            let clonedResponse = response.clone();
                            if (response.ok) {
                                cache.put(request, response);
                            }
                            return clonedResponse;
                        });
                });
        });
}

/**
 * Remove start and end-quote marks from a string.
 *
 * @param text
 * @param startQuote
 * @param endQuote
 * @param required {boolean} whether the function should throw if the start or end-quote aren't present
 * @returns {string}
 */
function unquote(text, startQuote, endQuote, required) {
    let startError = '(' + text + ')' + ' does not start with ' + '(' + startQuote + ')';
    let endError = '(' + text + ')' + ' does not end with ' + '(' + endQuote + ')';
    text = text.trim();
    if (!text.startsWith(startQuote)) {
        if (required) throw new Error(startError);
        if (text.endsWith(endQuote)) throw new Error(startError);
        return text;
    }

    if (!text.endsWith(endQuote)) {
        throw new Error(endError);
    }

    return text.substring(startQuote.length, text.length - endQuote.length);
}

/**
 * Resolve a relative-url using a base-url.
 *
 * @param url
 * @param base
 * @returns {string}
 * @throws if the relative-url is null.
 */
function resolveURL(url, base) {
    if (url == null) throw new Error("Invalid relative URL");
    return new URL(url, base).href;
}
