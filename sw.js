/**
 * Pattern for detecting markdown resource requests.
 * @type {RegExp}
 */
const MARKDOWN_MATCHER = /\.md$/i;

/**
 * Name of the cache for htmlified markdown resources.
 * @type {string}
 */
const CACHE = 'markdown-cache';

importScripts(
    'https://unpkg.com/commonmark@0.29.0/dist/commonmark.js'
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
 * @param url
 * @param event
 * @param params
 * @returns {Promise<Response | undefined>|*}
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
            //console.log('requestWillFetch', request);
            let headers = new Headers(request.headers);
            headers.set('Accept', 'text/markdown');
            request = new Request(request.url, {
                cache: 'reload',
                headers
            });
            return request;
        },
        cacheWillUpdate: ({request, response}) => {
            //console.log('cacheWillUpdate', response);
            return response.text()
                .then((text) => htmlifyWithHeaders(text, response.headers, request.url))
                .then((html) => {
                    let headers = new Headers(response.headers);
                    headers.set('Content-Type', 'text/html');
                    headers.set('Content-Length', html.length);
                    let cacheableResponse = new Response(html, {
                        headers
                    });
                    return cacheableResponse;
                });
        },
        cacheDidUpdate: ({cacheName, request, oldResponse, newResponse}) => {
            //console.log('cacheDidUpdate', newResponse);
        },
        cachedResponseWillBeUsed({cacheName, request, matchOptions, cachedResponse}) {
            //console.log('cachedResponseWillBeUsed', cachedResponse);
            return cachedResponse;
        }
    };

    let cache;

    // We (effectively) use a cache-first strategy unless the user is reloading the page (Meta-R)
    // in which case we use network-first.
    // Network requests allow modifying the request ...
    // and also the network response before it is added to the cache.
    // In all cases the cached-response can be modified before it is used to fulfil the browser-context request.
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
        })

}

/**
 * Generate a document as HTML from a resources body-text, headers and url.
 *
 * @async
 * @param text
 * @param headers
 * @param url
 * @returns {string}
 */
function htmlifyWithHeaders(text, headers, url) {
    let links = extractLinksFromHeaders(headers);
    return resolveLinkedLinks(links, url)
        .then((linkedLinks) => htmlifyWithLinks(text, links.concat(linkedLinks)));
}

/**
 * Generate a document as HTML from a resources body-text and provided links.
 *
 * @param text
 * @param links
 * @returns {string}
 */
function htmlifyWithLinks(text, links) {
    let html = transcode(text);
    let title = "FIXME: <title> not implemented";
    let linksHtml = links.map((link) => {
        if (['text/javascript', 'application/javascript', 'module'].includes(link.type)) {
            return `<script src="${link.href}" type="${link.type}"></script>`;
        }
        return `<link` +
            ( link.href ? ` href="${link.href}"` : `` ) +
            ( link.rel ? ` rel="${link.rel}"` : `` ) +
            ( link.type ? ` type="${link.type}"` : `` ) +
            ` />`;
    }).join('\n');
    // FIXME needs charset
    return `
<!DOCTYPE html>
<html>
<head>
<title>${title}</title>
${linksHtml}
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
 * Convert markdown to html.
 *
 * @param markdown
 * @returns {string} the equivalent html (does not include <html>, <head>, <body>, etc).
 */
function transcode(markdown) {
    let reader = new commonmark.Parser();
    let writer = new commonmark.HtmlRenderer();
    let parsed = reader.parse(markdown); // parsed is a 'Node' tree
    let result = writer.render(parsed); // result is a String
    return result;
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
 * Currently extracts links from the links array in the manifest file
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
 * Extract a list of link descriptors from a manifest
 * @param manifest
 * @param manifestUrl
 * @returns {Array<Object>}
 */
function extractLinksFromManifest(manifest, manifestUrl) {
    if (!manifest || !manifest.links) return [];
    let links = manifest.links; // FIXME should use a deep-clone.
    links.forEach((link) => link.href = resolveURL(link.href, manifestUrl));
    return links;
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
