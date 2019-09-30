(function() {

    var _ = Meeko.stuff;
    var DOM = Meeko.DOM;
    var URL = Meeko.URL;

    var framesetURL = document.querySelector('link[rel=shell_url]').href;
    var baseURL = URL(framesetURL);
    var scope = baseURL.base;

    Meeko.framer.config({
        /*
        The framesetURL can be dependent on anything, for-instance
        + device / window dimensions
            - to provide optimal layout
        + browser
            - to give minimal support to old browsers
        + a theme setting from localStorage
            - allows you to test a frameset-document on the live site
         */

        lookup: function(url) {
            if (!scope) return; // first time

            // FIXME better notification for leaving doc-set
            if (url.indexOf(scope) !== 0) return;
            return {
                framesetURL: framesetURL,
                scope: scope
            }
        },

        detect: function(doc) {
            if (scope) return this.lookup(document.URL); // shouldn't be needed. lookup() will be valid

            scope = baseURL.base;

            return this.lookup(document.URL);
        }
    });

    fetch(document.URL)
        .then((response) => response.text())
        .then((html)=> (new DOMParser).parseFromString(html, 'text/html'))
        .then((doc) => {
            Meeko.framer.start({
                contentDocument: Promise.resolve(doc)
            })
        });

})();
