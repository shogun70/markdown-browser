// Check that service workers are registered
if ('serviceWorker' in navigator) (function() {
    let serviceWorkerURL = './sw.js';

    if (!navigator.serviceWorker.controller) {
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
                    });
                }
            });
    }
})();
