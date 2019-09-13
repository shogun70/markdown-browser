<?php
    /**
     * The boot-script file in the same directory as this html-handler
     */
    $BOOTSCRIPT_FNAME = 'boot.js';

    /**
     * The web-manifest file in an ancestor directory of the markdown resource.
     */
    $MANIFEST_FNAME = 'manifest.json';

    /**
     * Whether to add "Link" headers from links in the manifest.
     */
    $ADD_LINKS_FROM_MANIFEST = true;

    /**
     * Set from RewriteRule in .htaccess
     */
    $RESOURCE_PATH = $_GET['path'];

    /**
     * Set by HTTP client. 
     */
    $HTTP_ACCEPT = $_SERVER['HTTP_ACCEPT'];

    /**
     * Find the relative path of the desired file-name which is in the current directory or an ancestor directory.
     *
     * @param string $name
     * @param string $currentDir
     * @param string $relDir for internal use only.
     * @return string
     */
    function find_ancestor_file($name, $currentDir, $relDir = '.') {
        // WARN this doesn't check that the file is actually within DOCUMENT_ROOT
        // although it does stop the search at the directory of the php-script (which is probably more restrictive).
        $filepath = "$currentDir/$name";
        $relpath = "$relDir/$name";

        if (file_exists($filepath)) return $relpath;
        if ($currentDir === "." || $currentDir === "") return null;
        $currentDir = dirname($currentDir);
        $relDir = $relDir === '.' ? '..' : "$relDir/..";
        return find_ancestor_file($name, $currentDir, $relDir);
    }

    /**
     * @param $rel {string} the url to resolve. Can already be resolved.
     * @param $base {string} the url to resolve against. Can be relative.
     * @return string
     */
    function resolve_url($rel, $base) {
        // Adapted from https://99webtools.com/blog/convert-relative-path-into-absolute-url/
        if(strpos($rel,"//") === 0) return $rel; // WARN assume browsers accept urls starting with '//'
        if  (parse_url($rel, PHP_URL_SCHEME) != '') return $rel; // return if  already absolute URL
        if ($rel[0] == '#'  || $rel[0] == '?') return "$base$rel"; // queries and  anchors

        // parse base URL  and convert to local variables:
        $scheme = ''; $host = ''; $path = '';
        extract(parse_url($base));
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

    $resourceDir = dirname($RESOURCE_PATH);
    $revPathWithTrailingSlash = $resourceDir === '.' ?
        './' :
        preg_replace('/[^\/]+\//', '../', "$resourceDir/");

    $bootScript = "$revPathWithTrailingSlash$BOOTSCRIPT_FNAME";
    $manifest_path = find_ancestor_file($MANIFEST_FNAME, $resourceDir);

    header("Content-Type: $type");
    $links = [];
    if ($manifest_path) {
        $manifest = (object) ['href' => $manifest_path, 'rel' => 'manifest', 'type' => 'application/json'];
        if (!$ADD_LINKS_FROM_MANIFEST) {
            $manifest->{'rel'} = $manifest->{'rel'} . " links";
        }
        array_push($links, $manifest);
        if ($ADD_LINKS_FROM_MANIFEST) {
            $manifest_contents = file_get_contents("$resourceDir/$manifest_path");
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
<link rel="manifest" href="<?= $manifest_path ?>" />
<?php endif; ?>
<script src="<?= $bootScript ?>"></script>
<plaintext type="text/markdown">
<?php endif; ?>
<?php include($RESOURCE_PATH); ?>