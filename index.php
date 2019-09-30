<?php
    /*
     * This script makes several assumptions:
     * - That the HTTP server is Apache (which version?)
     * - It is called from an internal redirection from the url of the actual markdown resource.
     * - FIXME: That the resource exists.
     * - That the resource and this script are in the same DOCUMENT_ROOT (is this essential?)
     * - That the boot-script and serviceworker-script exist.
     * - That the manifest (if it exists) has a "links" array of url descriptors ("href", "rel", "type").
     * - For performance you should enabled HTTP2 so boot-script, serviceworker, manifest are preloaded.
     *
     * Tips for HTTP2:
     * - Browsers only support HTTP2 over HTTPS therefore you need a valid certificate.
     * - You can get browsers to accept a self-signed certificate but it seems convoluted:
     *    + The certificate needs at least "subjectAltName".
     *    + You need to add the rootCA that signed the cert to the list of trusted CAs.
     *      This doesn't seem to be consistent across browsers and OSes.
     * - HTTP2 push isn't smooth-sailing. See https://jakearchibald.com/2017/h2-push-tougher-than-i-thought/
     *    + Some resources will need a non-zero cache-control.
     */

    /**
     * The boot-script file in the same directory as this html-handler
     */
    $BOOTSCRIPT_FNAME = 'boot.js';

    /**
     * The serviceworker file in the same directory as this html-handler
     */
    $SERVICEWORKER_FNAME = 'serviceworker.js';

    /**
     * The web-manifest file in an ancestor directory of the markdown resource.
     */
    $MANIFEST_FNAME = 'manifest.json';

    /**
     * Whether to add "Link" headers from links in the manifest.
     */
    $ADD_LINKS_FROM_MANIFEST = false;

    /**
     * Set by HTTP client. 
     */
    $HTTP_ACCEPT = $_SERVER['HTTP_ACCEPT'];

    /**
     * Absolute path in local fs
     */
    $DOCUMENT_ROOT = $_SERVER['DOCUMENT_ROOT'];

    /**
     * Absolute path for the PHP script url
     */
    $SCRIPT_NAME = $_SERVER['SCRIPT_NAME'];

    /**
     * Absolute path for the request url.
     */
    $REQUEST_URI = $_SERVER['REQUEST_URI'];

    /**
     * Relative path from the PHP script to the requested resource.
     */
    $RESOURCE_PATH = parse_url($REQUEST_URI)['path'];

    /**
     * Detects if the server will "push" links with rel="preload".
     */
    $SUPPORTS_PUSH = $_SERVER['H2PUSH'] == 'on';

    /**
     * Convert the url path to an absolute path in the local fs.
     * @param $url_path the *absolute* url path
     * @return string
     */
    function resolve_fs_path($url_path) {
        global $DOCUMENT_ROOT;
        return "$DOCUMENT_ROOT$url_path";
    }

    /**
     * Find the url path of the desired file-name which is in the current directory or an ancestor directory.
     *
     * @param $name {string}
     * @param $currentDir (string} the absolute url path for the current directory
     * @return string
     */
    function find_ancestor_file($name, $currentDir) {
        // WARN this doesn't check that the file is actually within DOCUMENT_ROOT
        // although it does stop the search at the directory of the php-script (which is probably more restrictive).
        $urlpath = "$currentDir/$name";
        $fspath = resolve_fs_path($urlpath);

        if (file_exists($fspath)) return $urlpath;
        if ($currentDir === "/") return null;
        $currentDir = dirname($currentDir);
        return find_ancestor_file($name, $currentDir);
    }

    /**
     * Resolve a relative url to a base url.
     * The base url can also be a relative or absolute *path*.
     * FIXME: Ignores user / pass / port of base url.
     *
     * @param $rel {string} the url to resolve. Can already be resolved.
     * @param $base {string} the url to resolve against. Can be a relative or absolute path.
     * @return string
     */
    function resolve_url($rel, $base) {
        // Adapted from https://99webtools.com/blog/convert-relative-path-into-absolute-url/
        if(strpos($rel,"//") === 0) return $rel; // WARN: assume browsers accept urls starting with '//'
        if  (parse_url($rel, PHP_URL_SCHEME) != '') return $rel; // return if  already absolute URL
        if ($rel[0] == '#'  || $rel[0] == '?') return "$base$rel"; // queries and  anchors

        $url = parse_url($base);
        $scheme = $url['scheme']; $host = $url['host']; $path = $url['path'];
        // remove  non-directory element from path
        $path = preg_replace('#/[^/]*$#',  '', $path);
        // destroy path if  relative url points to root
        if ($rel[0] ==  '/') $path = '';

        // dirty absolute path
        $abspath =  "$path/$rel";
        // replace '//' or  '/./' or '/foo/../' with '/'
        $re =  array('#(/\.?/)#', '#/(?!\.\.)[^/]+/\.\./#');
        $abspath = preg_replace($re, '/', $abspath);
        // replace './' at start of path
        $abspath = preg_replace('#^\./#', '', $abspath);
        return  $scheme ? "$scheme://$host$abspath" : $abspath;
    }

    $type = (preg_match('/^text\/html/', $HTTP_ACCEPT) && !preg_match('/^text\/markdown/', $HTTP_ACCEPT)) ?
            'text/html' : 'text/markdown';

    $scriptDir = dirname($SCRIPT_NAME);
    $bootScript = "$scriptDir/$BOOTSCRIPT_FNAME";
    $serviceWorker = "$scriptDir/$SERVICEWORKER_FNAME";

    $resourceDir = dirname($RESOURCE_PATH);
    $manifest_path = find_ancestor_file($MANIFEST_FNAME, $resourceDir);

    header("Content-Type: $type");

    /*
     * If HTTP2 is enabled then pushed resources are indicated by a HTTP header like "Link: <url>; rel=preload".
     * But pushed resources don't get into the browser-cache unless they are requested before the HTTP connection is closed.
     * Therefore pushed resources should also have a HTML link like <link href="url" rel="preload" as="???" />.
     * What to use for @as isn't always obvious, see https://developer.mozilla.org/en-US/docs/Web/HTML/Preloading_content
     * - Chrome doesn't seem to need the HTML links if the HTTP headers are configured just right.
     * - I'm still experimenting with Firefox.
     * - Do browsers accept HTTP Link headers with @as?
     */
    $links = [];
    if ($SUPPORTS_PUSH && $type == 'text/html') {
        array_push($links, (object) ['href' => $bootScript, 'rel' => 'preload', 'as' => 'script', 'type' => 'text/javascript']);
        array_push($links, (object) ['href' => $serviceWorker, 'rel' => 'preload', 'as' => 'worker', 'type' => 'text/javascript']);
    }

    if ($manifest_path) {
        /*
         * FIXME: Apparently pushed resources with @as='fetch' need to have @crossorigin='anonymous'
         *   or fetch() ignore the item from the push-cache due to request headers mismatch.
         *   Need to verify if @crossorigin can always be 'anonymous'.
         */
        $manifest = (object) ['href' => $manifest_path, 'rel' => 'manifest', 'type' => 'application/json', 'crossorigin' => 'anonymous'];
        if (!$ADD_LINKS_FROM_MANIFEST) {
            $manifest->{'rel'} .= ' links';
        }
        if ($SUPPORTS_PUSH && $type == 'text/html') {
            $manifest->{'rel'} .= ' preload';
            $manifest->{'as'} = 'fetch';
        }
        array_push($links, $manifest);
        if ($ADD_LINKS_FROM_MANIFEST) {
            $manifest_contents = file_get_contents(resolve_fs_path($manifest_path));
            $manifest_json = json_decode($manifest_contents);
            $manifest_links = $manifest_json->{'links'};
            foreach($manifest_links as $link) {
                $href = $link->{'href'};
                $link->{'href'} = resolve_url($href, $manifest_path);
                array_push($links, $link);
            }
        }
    }
    $link_headers = [];
    foreach ($links as $link) {
        $href = $link->{'href'};
        $header_string = "<$href>";
        foreach ($link as $key => $value) {
            if ($key == 'href') continue;
            if (strpos($value, ' ')) $value = '"' . $value . '"';
            $header_string .= "; $key=$value";
        }
        array_push($link_headers, $header_string);
    }
    if (count($link_headers) > 0) header("Link: " . join(", ", $link_headers), false);
    if ($type === 'text/html'):
?>
<!DOCTYPE html>
<meta charset="UTF-8" />
<?php if ($manifest_path): ?>
<link rel="manifest <?= $SUPPORTS_PUSH ? 'preload' : ''?>" href="<?= $manifest_path ?>" as="fetch" crossorigin="anonymous"/>
<?php endif; ?>
<link href="<?= $serviceWorker ?>" rel="serviceworker <?= $SUPPORTS_PUSH ? 'preload' : ''?>" as="worker" type="text/javascript" />
<script src="<?= $bootScript ?>" type="text/javascript"></script>
<plaintext type="text/markdown">
<?php endif; ?>
<?php include(resolve_fs_path($RESOURCE_PATH)); ?>
