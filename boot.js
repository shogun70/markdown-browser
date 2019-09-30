// Check that service workers are registered
if ('serviceWorker' in navigator) (function() {
    const SERVICEWORKER_FNAME = 'serviceworker.js';
    function getServiceWorkerUrl() {
        // TODO: Maybe this should lookup serviceworker in the manifest.json
        let swLink = document.querySelector('link[rel~="serviceworker"i]');
        return swLink ? swLink.href : new URL(SERVICEWORKER_FNAME, document.currentScript.src).href;
    }

    function awaitPreloads() {
        // This is mostly a work-around for Firefox not supporting preload links.
        // FIXME: Potentially this could stall startup - it should have a timeout behavior.
        return Promise.all(
            [...document.querySelectorAll('link[rel~="preload"i]')]
                .map((link) => fetch(link.href)));
    }

    if (!navigator.serviceWorker.controller) {
        awaitPreloads()
            .then(() => {
                let serviceWorkerUrl = getServiceWorkerUrl();
                navigator.serviceWorker.register(serviceWorkerUrl)
                    .then((registration) => {
                        let serviceWorker = registration.installing || registration.waiting || registration.active;
                        if (serviceWorker) {
                            //console.log(serviceWorker.state);
                            if (serviceWorker.state === 'activated') location.reload();
                            else serviceWorker.addEventListener('statechange', (e) => {
                                //console.log(e.target.state);
                                if (e.target.state === 'activated') location.reload();
                            });
                        }
                    });
            });

    }
})();
