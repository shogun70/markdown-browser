<!DOCTYPE html>
<meta charset="UTF-8" />
<script src="<?= preg_replace('/[^\/]+$/', 'boot.js', preg_replace('/[^\/]+\//', '../', $_GET['path'])) ?>"></script>
<plaintext type="text/markdown">
<?php include($_GET['path']); ?>