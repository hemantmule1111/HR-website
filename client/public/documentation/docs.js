// Behaviour for /documentation: index highlighting, collapsible index on small screens, and search.
// The page content itself is plain HTML, so it is readable even if this script does not run.
(function () {
  var doc = document.getElementById('doc');
  var toc = document.getElementById('toc');
  var list = document.getElementById('toc-list');
  if (!doc || !toc || !list) return;

  var heads = Array.prototype.slice.call(doc.querySelectorAll('h2, h3'));
  var level = function (h) { return h.tagName === 'H2' ? 2 : 3; };

  // Text of every section, so search can match what is written under a heading.
  var textOf = new Map();
  heads.forEach(function (h) {
    var t = h.textContent + ' ', n = h.nextElementSibling;
    while (n && !(/^H[1-3]$/.test(n.tagName) && Number(n.tagName.charAt(1)) <= level(h))) { t += n.textContent + ' '; n = n.nextElementSibling; }
    textOf.set(h, t.toLowerCase());
  });

  var items = Array.prototype.slice.call(list.querySelectorAll('li')).map(function (li) {
    var a = li.querySelector(':scope > a');
    return { li: li, a: a, h: document.getElementById(a.getAttribute('href').slice(1)), top: li.classList.contains('h2') };
  }).filter(function (it) { return it.h; });

  // The index starts open on wide screens and closed on phones.
  var wide = window.matchMedia('(min-width: 960px)');
  var sync = function () { toc.open = wide.matches; };
  sync();
  if (wide.addEventListener) wide.addEventListener('change', sync);
  list.addEventListener('click', function (e) { if (e.target.tagName === 'A' && !wide.matches) toc.open = false; });

  // Highlight the section being read.
  var current = null;
  function setActive(h) {
    if (current === h) return;
    current = h;
    var active = items.filter(function (x) { return x.h === h; })[0];
    items.forEach(function (it) {
      it.a.classList.toggle('active', it.h === h);
      if (it.top) it.li.classList.toggle('open', it.h === h || (!!active && !active.top && it.li.contains(active.li)));
    });
  }
  var seen = new Set();
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) seen.add(en.target); else seen.delete(en.target); });
      var first = heads.filter(function (h) { return seen.has(h); })[0];
      if (first) setActive(first);
    }, { rootMargin: '0px 0px -70% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  }
  if (heads.length) setActive(heads[0]);

  // Search the index by heading and by the text under each heading.
  var q = document.getElementById('q');
  var none = document.getElementById('toc-none');
  q.addEventListener('input', function () {
    var v = q.value.trim().toLowerCase(), shown = 0;
    toc.classList.toggle('searching', !!v);
    items.forEach(function (it) { it.hit = !v || textOf.get(it.h).indexOf(v) > -1; });
    items.forEach(function (it) {
      if (it.top) {
        var any = it.hit || items.some(function (k) { return !k.top && k.hit && it.li.contains(k.li); });
        it.li.hidden = !any;
        if (any) shown += 1;
      } else {
        it.li.hidden = !it.hit;
      }
    });
    none.hidden = shown > 0;
  });

  // Jump to a section named in the address (for example /documentation#5-hr-and-admin-guide).
  if (location.hash.length > 1) {
    var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
  }
})();
