<?php
    $BOOTSCRIPT_FNAME = 'boot.js';
    $MANIFEST_FNAME = 'manifest.json';
    $RESOURCE_PATH = $_GET['path'];
    $HTTP_ACCEPT = $_SERVER['HTTP_ACCEPT'];

    function find_ancestor_file($name, $currentDir, $relDir = '') {
        if (!$relDir) $relDir = '.';
        $filepath = "$currentDir/$name";
        $relpath = "$relDir/$name";

        if (file_exists($filepath)) return $relpath;
        if ($currentDir === "." || $currentDir === "") return false;
        $currentDir = dirname($currentDir);
        $relDir = $relDir === '.' ? '..' : "$relDir/..";
        return find_ancestor_file($name, $currentDir, $relDir);
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
    header("Link: <$bootScript>; rel=boot", false);
    if ($manifest_path) header("Link: <$manifest_path>; rel=manifest", false);
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

