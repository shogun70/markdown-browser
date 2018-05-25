// Check that service workers are registered
if ('serviceWorker' in navigator) {
    // Use the window load event to keep the page load performant
    let workerScriptURL = new URL('./sw.js', document.currentScript.src).href;
    navigator.serviceWorker.register(workerScriptURL, { randow: 123 })
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
