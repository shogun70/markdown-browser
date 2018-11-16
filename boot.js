// Check that service workers are registered
if ('serviceWorker' in navigator) (function() {
    let serviceWorkerURL = './sw.js';

    if (navigator.serviceWorker.controller) {
        let manifestLink = document.querySelector('link[rel~="manifest" i]');
        if (!manifestLink) return;
        let manifestUrl = manifestLink.href;
        fetch(manifestUrl)
            .then((response) => response.json())
            .then((manifestJson) => {
                if (!manifestJson) return;
                let shellUrl = manifestJson.shell_url;
                if (!shellUrl) return;
                shellUrl = new URL(shellUrl, manifestUrl).href;
                // TODO sanity check shellUrl
                location.replace(shellUrl);
            });
    }
    else {
        let absServiceWorkerURL = new URL(serviceWorkerURL, document.currentScript.src).href;
        navigator.serviceWorker.register(absServiceWorkerURL)
            .then((registration) => {
                let serviceWorker = registration.installing || registration.waiting || registration.active;
                if (serviceWorker) {
                    //console.log(serviceWorker.state);
                    if (serviceWorker.state === 'activated') location.reload();
                    else serviceWorker.addEventListener('statechange', (e) => {
                        //console.log(e.target.state);
                        if (e.target.state === 'activated') location.reload();
                        // TODO instead of reloading the current-page this should redirect to shellUrl (if declared)
                    });
                }
            });
    }
})();
