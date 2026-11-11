// Shows a plain message instead of a blank page when the app cannot start. A separate file (not inline) so the strict security policy can stay on.
/* If the app cannot start (wrong files, missing files, blocked scripts), show a plain message instead of a blank page. */
(function () {
  var src = document.currentScript.src;
  var base = src.slice(0, src.lastIndexOf('/') + 1).split('/').slice(3).join('/'); // the folder this site lives in, e.g. "" or "hr/"
  base = '/' + base;
  function show(why) {
    var root = document.getElementById('root');
    if (!root || root.children.length) return;
    root.innerHTML = '<div style="max-width:580px;margin:12vh auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.55;color:#16202e">' +
      '<h1 style="font-size:1.4rem;margin:0 0 .6rem">WorkPilot could not start</h1><p>' + why + '</p>' +
      '<p>The usual causes: the website files for a different address were uploaded (for example the <b>/hr/ folder</b> package on a subdomain), the files are in the wrong folder, or the host is showing an old cached copy.</p>' +
      '<p>Open <a href="' + base + 'check.php">' + base + 'check.php</a> on this site for a checklist. If you have already deleted it, upload it again from the package.</p></div>';
  }
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) show('A required file did not load: <code>' + (t.src || t.href) + '</code>.');
  }, true);
  window.addEventListener('load', function () { setTimeout(function () { show('The page opened, but the program did not start.'); }, 4000); });
})();
