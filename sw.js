
importScripts(
    'https://storage.googleapis.com/workbox-cdn/releases/3.1.0/workbox-sw.js',
    'https://rawgit.com/commonmark/commonmark.js/master/dist/commonmark.js'
    );

if (!commonmark) throw 'Markdown parser failed to install.';
if (!workbox) throw 'ServiceWorker failed to install.';

self.addEventListener('install', function(event) {
    // The promise that skipWaiting() returns can be safely ignored.
    self.skipWaiting();

    // Perform any other actions required for your
    // service worker to install, potentially inside
    // of event.waitUntil();
});

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

function handler({ url, event, params }) {
    return new Promise((resolve, reject) => {


        let strategy = workbox.strategies.cacheFirst;

        if (event.request.mode === 'navigate' &&
            event.request.referrer === event.request.url) {
            strategy = workbox.strategies.networkFirst;
        }


        let handler = strategy({
            plugins: [
                {
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
                            resolve(cacheableResponse.clone());
                            return cacheableResponse;
                        });
                    },
                    cacheDidUpdate: ({cacheName, request, oldResponse, newResponse}) => {
                        //console.log('cacheDidUpdate', newResponse);
                    },
                    cachedResponseWillBeUsed({cacheName, request, matchOptions, cachedResponse}) {
                        //console.log('cachedResponseWillBeUsed', cachedResponse);
                        if (cachedResponse) resolve(cachedResponse);
                        return cachedResponse;
                    }
                }
            ]
        });

        handler.handle({ event }).then((response) => {
                // console.log('handle() completed', response);
        });

    });

}

let cacheOnlyStrategy = workbox.strategies.cacheOnly();


workbox.routing.registerRoute(
    new RegExp('.*\.md'),
    handler
);
