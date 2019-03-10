
importScripts(
    'https://unpkg.com/commonmark@0.28.1/dist/commonmark.js'
    );

if (!commonmark) throw 'Markdown parser failed to install.';

self.addEventListener('install', function(event) {
    // The promise that skipWaiting() returns can be safely ignored.
    self.skipWaiting();

    // Perform any other actions required for your
    // service worker to install, potentially inside
    // of event.waitUntil();
});

const MARKDOWN_MATCHER = /\.md$/i;

function transcode(markdown) {
    let reader = new commonmark.Parser();
    let writer = new commonmark.HtmlRenderer();
    let parsed = reader.parse(markdown); // parsed is a 'Node' tree
    let result = writer.render(parsed); // result is a String
    return result;
}

function htmlify(text, headers) {
    let html = transcode(text);
    let links = headers.get('Link').split(/\s*,\s*/)
        .map((text) => {
            let m = text.match(/^\s*<\s*([^>]*)>\s*;\s*rel=(\w*)\s*$/i);
            return [m[2], m[1]];
        });
    let linksHtml = links.map((item) => {
        let href = item[1], rel = item[0];
        return `<link rel="${rel}" href="${href}" />`;
    }).join('\n');
    let bootScript = links.find(([rel, href]) => /^boot$/i.test(rel))[1];
    return `
<!DOCTYPE html>
<html>
<head>
${linksHtml}
<script src="${bootScript}"></script>
</head>
<body>
<main>
${html}
</main>
</body>
</html>
    `;

}

function getShellUrl(url, response) {
    let headers = response.headers;
    let links = headers.get('Link').split(/\s*,\s*/)
        .map((text) => {
            let m = text.match(/^\s*<\s*([^>]*)>\s*;\s*rel=(\w*)\s*$/i);
            return [m[2], m[1]];
        });
    let linksHtml = links.map((item) => {
        let href = item[1], rel = item[0];
        return `<link rel="${rel}" href="${href}" />`;
    }).join('\n');
    let manifestUrl = links.find(([rel, href]) => /^manifest$/i.test(rel))[1];
    manifestUrl = new URL(manifestUrl, url).href;
    return fetch(manifestUrl)
        .then((response) => response.json())
        .then((manifestJson) => {
            if (!manifestJson) return;
            let shellUrl = manifestJson.shell_url;
            if (!shellUrl) return;
            return new URL(shellUrl, manifestUrl).href;
        });
}

function shellOrPassThru(url, response) {
    return getShellUrl(url, response)
        .then((shellUrl) => {
            if (shellUrl) console.info("Fetching shell:", shellUrl);
            if (!shellUrl) return response;

            return fetch(shellUrl)
                .then((shellResponse) => {
                    if (!shellResponse.ok) console.warn("Could not load shell:", shellUrl);
                    return shellResponse.ok ? shellResponse : response;
                });
        });
}

var CACHE = 'markdown-cache';

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
            return response.text().then((text) => {
                let html = htmlify(text, response.headers);
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
            return !isNavigating ?
                cachedResponse :
                shellOrPassThru(url, cachedResponse);
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

self.addEventListener('fetch', function(event) {
    if (MARKDOWN_MATCHER.test(event.request.url)) {
        event.respondWith(
            handler({ url: event.request.url, event, params: null})
        );
    }
});