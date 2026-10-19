// Invite flow: tap to open -> intro video -> hand-off to the page, background music, staged image loading.
(function () {
  var intro = document.getElementById('intro');
  var video = document.getElementById('intro-video');
  var audio = document.getElementById('music');
  var muteBtn = document.getElementById('mute');
  var sections = Array.prototype.slice.call(document.querySelectorAll('.sec'));
  var MUSIC_VOLUME = 0.5;   // half volume, as asked
  var FADE_IN_S = 2;

  // ---------- staged image loading ----------
  // The poster and the intro video come first. Sections 1-2 load while the guest looks at the poster or
  // watches the intro; the rest load just ahead of scrolling, and then quietly in the background.
  function loadSection(sec) {
    if (!sec || sec.dataset.loaded) return Promise.resolve();
    sec.dataset.loaded = '1';
    var imgs = sec.querySelectorAll('img[data-src]');
    return Promise.all(Array.prototype.map.call(imgs, function (img) {
      img.src = img.getAttribute('data-src');
      img.removeAttribute('data-src');
      return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
    }));
  }
  function loadFirst() { return loadSection(sections[0]).then(function () { return loadSection(sections[1]); }); }
  var firstLoaded = null;
  function startFirst() { if (!firstLoaded) firstLoaded = loadFirst(); return firstLoaded; }
  // start on the video being ready, or after 1.5 s at the latest
  video.addEventListener('canplaythrough', startFirst, {once: true});
  setTimeout(startFirst, 1500);

  // after the intro: load sections just ahead of scrolling (held back until then so the video loads first)
  function watchScrolling() {
    if (!('IntersectionObserver' in window)) { sections.forEach(loadSection); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = sections.indexOf(e.target);
        loadSection(sections[i]);
        loadSection(sections[i + 1]);
      });
    }, {rootMargin: '0px 0px 150% 0px'});
    sections.forEach(function (s) { io.observe(s); });
  }
  function loadRestInBackground() {
    var i = 0;
    (function next() {
      if (i >= sections.length) return;
      loadSection(sections[i++]).then(function () { setTimeout(next, 150); });
    })();
  }

  // ---------- entrance animations ----------
  // Split animated lines into letters, then start a section's animations once it is properly in view:
  // 60% of the screen filled by it (or 90% of the section showing, on screens much taller than a section). Played once.
  var LETTER_KINDS = {pop: 1, type: 1, letters: 1, drop: 1};
  Array.prototype.forEach.call(document.querySelectorAll('[data-anim]'), function (el) {
    if (!LETTER_KINDS[el.getAttribute('data-anim')]) return;
    var i = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 1) { walk(n); return; }
        if (n.nodeType !== 3) return;
        var frag = document.createDocumentFragment();
        n.textContent.split('').forEach(function (c) {
          if (c === ' ' || c === '\n') { frag.appendChild(document.createTextNode(c)); return; }
          var sp = document.createElement('span');
          sp.className = 'ch';
          sp.style.setProperty('--i', i++);
          sp.textContent = c;
          frag.appendChild(sp);
        });
        n.parentNode.replaceChild(frag, n);
      });
    })(el);
    el.classList.add('split');
  });
  function watchAnimations() {
    if (!('IntersectionObserver' in window)) { sections.forEach(function (s) { s.classList.add('in'); }); return; }
    var steps = []; for (var t = 0; t <= 1; t += 0.05) steps.push(t);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.target.classList.contains('in')) return;
        var seen = e.intersectionRect.height;
        if (seen >= Math.min(0.6 * window.innerHeight, 0.9 * e.boundingClientRect.height)) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, {threshold: steps});
    sections.forEach(function (s) { io.observe(s); });
  }
  watchAnimations();

  // ---------- music ----------
  var ctx = null, gain = null, muted = false, musicOk = false;
  function startMusic() {
    if (!audio.getAttribute('src')) return;
    audio.preload = 'auto';
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(audio).connect(gain);
      gain.connect(ctx.destination);
    } catch (e) { ctx = null; }
    if (!ctx) audio.volume = MUSIC_VOLUME;   // fallback (iOS ignores this, hence the Web Audio gain above)
    var p = audio.play();
    if (p && p.then) {
      p.then(function () {
        musicOk = true;
        muteBtn.hidden = false;
        if (ctx) {
          var t = ctx.currentTime;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(MUSIC_VOLUME, t + FADE_IN_S);
        }
      }).catch(function () { muteBtn.hidden = true; });
    }
  }
  audio.addEventListener('error', function () { muteBtn.hidden = true; });
  function setMuted(m) {
    muted = m;
    muteBtn.classList.toggle('muted', m);
    muteBtn.setAttribute('aria-label', m ? 'Play music' : 'Mute music');
    if (m) { audio.pause(); } else { audio.play().catch(function () {}); }
  }
  muteBtn.addEventListener('click', function () { setMuted(!muted); });
  document.addEventListener('visibilitychange', function () {
    if (!musicOk) return;
    if (document.hidden) audio.pause();
    else if (!muted) audio.play().catch(function () {});
  });

  // ---------- tap to open -> intro -> page ----------
  var opened = false, finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    // make sure the first section is ready underneath, then fade the intro away
    var ready = Promise.race([startFirst(), new Promise(function (r) { setTimeout(r, 2500); })]);
    ready.then(function () {
      window.scrollTo(0, 0);
      document.body.classList.remove('locked');
      intro.classList.add('done');
      watchScrolling();
      setTimeout(function () {
        intro.parentNode && intro.parentNode.removeChild(intro);
        loadRestInBackground();
      }, 900);
    });
  }
  function open() {
    if (opened) return;
    opened = true;
    startMusic();
    startFirst();
    video.addEventListener('playing', function () { intro.classList.add('playing'); }, {once: true});
    video.addEventListener('ended', finish, {once: true});
    var p = video.play();
    if (p && p.catch) p.catch(finish);            // e.g. Low Power Mode refusing video: go straight to the page
    setTimeout(function () {                      // safety net if the video stalls
      if (!finished && (video.paused || video.currentTime < 0.2)) finish();
    }, 9000);
    setTimeout(finish, 15000);
  }
  intro.addEventListener('click', open);
  intro.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
})();
