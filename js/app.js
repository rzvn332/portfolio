/**
 * RZVN — app. Progressively-enhanced vanilla JS (no libraries).
 *
 * Design decisions baked in:
 *  - i18n updates text nodes in place (no DOM teardown, no flash, state kept);
 *  - project cards are <article> with a true overlay <button> (keyboard + SR safe);
 *  - modal & image viewer: role="dialog", focus trap, Escape, focus restore;
 *  - carousel assigns full-size sources lazily (current + neighbors only);
 *  - no global image preloading: grid thumbs load natively, below the fold;
 *  - `html.js` gates entrance animations so the page never hides without JS.
 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  // -------------------------------------------------------------- scroll lock
  // Position:fixed body lock: preserves scroll position when a layer opens
  // (iOS Safari and reset-prone browsers included).
  var savedScrollY = 0;
  function lockScroll() {
    if (document.body.style.position === 'fixed') return;
    savedScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = -savedScrollY + 'px';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, savedScrollY);
  }

  // ------------------------------------------------------------------ i18n
  var LANGS = ['en', 'ro', 'ru'];
  var state = {
    lang: (localStorage.getItem('lang') && LANGS.indexOf(localStorage.getItem('lang')) !== -1)
      ? localStorage.getItem('lang') : 'en',
    category: 'all',
    expanded: false,
    modalProject: null,
    modalIndex: 0,
    anchor: null
  };
  var YEAR = new Date().getFullYear();

  // Projects will be loaded dynamically
  var PROJECTS = [];

  function t(key) {
    var lang = I18N[state.lang];
    return ((lang && lang[key]) || I18N.en[key] || key).replace('{year}', YEAR);
  }

  //---------------------------------------------------------------------- plurals
  // CLDR-style plural pick for the aria count phrase ("2 проекта" vs "7 проектов").
  function pluralCategory(n) {
    if (state.lang === 'ru') {
      var m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return 'one';
      if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return 'few';
      return 'many';
    }
    if (state.lang === 'ro') {
      if (n === 1) return 'one';
      var m = n % 100;
      return (m > 0 && m < 20) ? 'few' : 'many';
    }
    return n === 1 ? 'one' : 'many';
  }

  function countPhrase(n) {
    return t('filter_aria_' + pluralCategory(n)).replace('{n}', n);
  }

  function projectField(project, field) {
    if (state.lang !== 'en') {
      var localized = project[field + '_' + state.lang];
      if (localized) return localized;
    }
    return project[field];
  }

  // Load projects from manifest + individual data.json files
  async function loadProjects() {
    try {
      var manifestResp = await fetch('projects/manifest.json');
      var slugs = await manifestResp.json();
      
      var projectPromises = slugs.map(function(slug) {
        return fetch('projects/' + slug + '/data.json').then(function(r) { return r.json(); });
      });
      
      PROJECTS = await Promise.all(projectPromises);
      PROJECTS.sort(function(a, b) { return a.id - b.id; });
      
      // Resolve image paths: prepend project slug
      PROJECTS.forEach(function(project) {
        var base = 'projects/' + project.slug + '/';
        (project.images || []).forEach(function(img) {
          if (img.t && !img.t.startsWith('http') && !img.t.startsWith('/')) img.t = base + img.t;
          if (img.f && !img.f.startsWith('http') && !img.f.startsWith('/')) img.f = base + img.f;
        });
      });
      
      // Compute filter counts
      FILTER_COUNTS = PROJECTS.reduce(function (acc, p) {
        acc[p.category] = (acc[p.category] || 0) + 1;
        return acc;
      }, {});
      FILTER_COUNTS.all = PROJECTS.length;
      
      // Initialize the rest of the app
      initApp();
    } catch (err) {
      console.error('Failed to load projects:', err);
      // Fallback to empty state
      PROJECTS = [];
      FILTER_COUNTS = { all: 0 };
      initApp();
    }
  }

  var FILTER_COUNTS = {};

  function applyI18n() {
    $$('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.documentElement.lang = state.lang;

    var toggle = $('#langToggle');
    if (toggle) toggle.textContent = state.lang.toUpperCase();

    $$('.lang-dropdown button').forEach(function (b) {
      b.setAttribute('aria-current', String(b.dataset.lang === state.lang));
    });

    // Filter tallies: visible [n] is hidden from SRs; the button's aria-label
    // carries the localized phrase instead ("UI/UX Design, 2 proiecte").
    $$('.filter').forEach(function (btn) {
      var cat = btn.dataset.category;
      var n = FILTER_COUNTS[cat] || 0;
      var countEl = btn.querySelector('.filter-count');
      if (countEl) countEl.textContent = '[' + n + ']';
      btn.setAttribute('aria-label', t('filter_' + cat) + ', ' + countPhrase(n));
    });
    var filtersGroup = $('.filters');
    if (filtersGroup) filtersGroup.setAttribute('aria-label', t('filter_group'));
    if (filterLine) positionFilterLine(true);

    updateCardTexts();
    if (state.modalProject) fillModalTexts(state.modalProject, false);
  }

  // ------------------------------------------------------- language switcher
  function initLanguageSwitcher() {
    var toggle = $('#langToggle');
    var dropdown = $('#langDropdown');
    if (!toggle || !dropdown) return;

    function setOpen(open) {
      dropdown.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!dropdown.classList.contains('open'));
    });

    dropdown.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var lang = btn.dataset.lang;
        if (lang !== state.lang) {
          localStorage.setItem('lang', lang);
          state.lang = lang;
          applyI18n();
        }
        setOpen(false);
        toggle.focus();
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.lang-wrapper')) setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dropdown.classList.contains('open')) {
        setOpen(false);
        toggle.focus();
      }
    });

    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'langDropdown');
  }

  // ------------------------------------------------------------------ menu
  function initMenu() {
    var btn = $('#menuBtn');
    var overlay = $('#menuOverlay');
    if (!btn || !overlay) return;

    function setOpen(open) {
      overlay.classList.toggle('open', open);
      if (open) lockScroll(); else unlockScroll();
      btn.setAttribute('aria-expanded', String(open));
    }

    btn.addEventListener('click', function () {
      setOpen(!overlay.classList.contains('open'));
    });

    overlay.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { setOpen(false); });
    });

    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'menuOverlay');
    window.__closeMenu = function () { setOpen(false); };
  }

  // ------------------------------------------------------------ site reveal
  function initReveal() {
    // Hero words get positional delay cues
    $$('.hero-title .word > span').forEach(function (sp, i) {
      sp.style.setProperty('--i', i);
    });

    var hero = $('.hero');
    if (hero) {
      (window.requestAnimationFrame || setTimeout)(function () {
        setTimeout(function () { hero.classList.add('revealed'); }, 220);
      });
    }

    var sections = $$('.content-section');
    if (!('IntersectionObserver' in window)) {
      sections.forEach(function (el) { el.classList.add('revealed'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    sections.forEach(function (s) { io.observe(s); });
  }

  // ------------------------------------------------------------------ cards
  var grid = $('#projects');

  function cardStagger(i) { return Math.min(i * 0.09, 0.45).toFixed(2) + 's'; }

  function openProjectByCard(project) {
    state.anchor = document.activeElement;
    openProjectModal(project);
  }

  function createCard(project, index, immediateNo) {
    var img = project.images[0] || null;
    var card = document.createElement('article');
    card.className = 'project-card';
    card.style.setProperty('--d', cardStagger(immediateNo));

    var head;
    card.innerHTML =
      '<div class="card-media">' +
      (img ?
        '<img src="' + img.t + '" alt="' + esc(project.alt || project.title) + '" width="' + img.w +
        '" height="' + img.h + '" loading="lazy" decoding="async">' : '') +
      '<div class="card-overlay"><svg class="icon" aria-hidden="true"><use href="#i-expand"></use></svg></div>' +
      '</div>' +
      '<div class="card-body">' +
      '<h3 data-field="title"><span data-field="title-text"></span><span class="chip">' + project.category.toUpperCase() + '</span></h3>' +
      '<p data-field="description"></p>' +
      '</div>' +
      '<button class="card-hit" type="button" aria-haspopup="dialog"></button>';

    head = card.querySelector('h3');
    head.querySelector('[data-field="title-text"]').textContent = projectField(project, 'title');
    card.querySelector('p').textContent = projectField(project, 'description');

    var hit = card.querySelector('.card-hit');
    hit._project = project;
    hit.setAttribute('aria-label', t('visually-open').replace('{n}', projectField(project, 'title')));
    hit.addEventListener('click', function () { openProjectByCard(project); });

    grid.appendChild(card);
    (window.requestAnimationFrame)(function () {
      (window.requestAnimationFrame)(function () {
        card.classList.add('revealed');
      });
    });
    head._project = project;
  }

  function projectsFor(category) {
    return category === 'all' ? PROJECTS : PROJECTS.filter(function (p) { return p.category === category; });
  }

  function renderProjects(category) {
    if (category) state.category = category;
    state.expanded = false;
    grid.innerHTML = '';

    var list = projectsFor(state.category);
    list.slice(0, 4).forEach(function (p, i) { createCard(p, i, i); });

    var more = list.length > 4;
    $('#showMoreBtn').hidden = !more;
    $('#showLessBtn').hidden = true;
    updateEmptyState(list.length === 0);
  }

  function showMore() {
    var list = projectsFor(state.category);
    state.expanded = true;
    list.slice(4).forEach(function (p, i) { createCard(p, i, i); });
    $('#showMoreBtn').hidden = true;
    $('#showLessBtn').hidden = false;
  }

  function showLess() {
    renderProjects(state.category);
  }

  function updateEmptyState(empty) {
    var note = $('#emptyNote');
    if (note) note.hidden = !empty;
  }

  function updateCardTexts() {
    $$('.project-card').forEach(function (card) {
      var project = card.querySelector('h3')._project;
      if (!project) return;
      card.querySelector('h3 [data-field="title-text"]').textContent = projectField(project, 'title');
      card.querySelector('p').textContent = projectField(project, 'description');
    });
    $$('.card-hit').forEach(function (hit) {
      // Refresh accessible labels for the currently rendered set
      if (hit._project) hit.setAttribute('aria-label', t('visually-open').replace('{n}', projectField(hit._project, 'title')));
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ------------------------------------------------------------------ filters
  function centerActiveFilter(btn) {
    // Mobile strip: bring the chosen category back into view.
    if (!window.matchMedia('(max-width: 640px)').matches) return;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    btn.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }

  var filterStrip = null;
  var filterLine = null;

  // Positions the sliding indicator under the active filter's text,
  // matching that button's exact text width (label start → closing ']').
  function positionFilterLine(instant) {
    if (!filterStrip || !filterLine) return;
    var pressed = filterStrip.querySelector('.filter[aria-pressed="true"]');
    if (!pressed) return;
    var label = pressed.querySelector('.filter-label');
    var count = pressed.querySelector('.filter-count');
    if (!label) return;
    var lRect = label.getBoundingClientRect();
    var rEdge = (count && count.textContent) ? count.getBoundingClientRect().right : lRect.right;
    // Content-space offset: viewport delta plus strip scroll (mobile strip)
    var left = lRect.left - filterStrip.getBoundingClientRect().left + filterStrip.scrollLeft;
    var width = Math.max(0, rEdge - lRect.left);
    if (instant) filterLine.style.transition = 'none';
    filterLine.style.left = left + 'px';
    filterLine.style.width = width + 'px';
    if (instant) { void filterLine.offsetWidth; filterLine.style.transition = ''; }
  }

  function initFilterLine() {
    filterStrip = $('.filters');
    filterLine = filterStrip ? filterStrip.querySelector('.filter-line') : null;
    if (!filterStrip || !filterLine) return;
    // Initial placement: no slide-in from a stale position
    positionFilterLine(true);
    // Fonts / language swaps change text widths — re-pin instantly
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { positionFilterLine(true); });
    }
    window.addEventListener('resize', function () { positionFilterLine(true); }, { passive: true });
  }

  function initFilters() {
    initFilterLine();
    $$('.filter').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.filter').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        positionFilterLine(false); // smooth slide + width morph
        renderProjects(btn.dataset.category);
        centerActiveFilter(btn);
      });
    });
  }

  // Toggles .at-start / .at-end on the filter strip so the CSS edge-fade
  // only appears where there is actually more to scroll.
  function initFilterStrip() {
    var strip = $('.filters');
    if (!strip) return;
    var ticking = false;
    function update() {
      ticking = false;
      var max = strip.scrollWidth - strip.clientWidth;
      strip.classList.toggle('at-start', strip.scrollLeft <= 2);
      strip.classList.toggle('at-end', strip.scrollLeft >= max - 2);
    }
    strip.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(update);
      }
      positionFilterLine(true); // indicator rides with the scrolled content
    }, { passive: true });
    window.addEventListener('resize', function () { update(); }, { passive: true });
    update();
  }

  // ------------------------------------------------------------------ modal
  var modal = $('#projectModal');
  var modalContent = modal ? modal.querySelector('.project-modal-content') : null;
  var modalCategory = $('#modalCategory');
  var modalTitle = $('#modalTitle');
  var modalDesc = $('#modalDescription');
  var modalTags = $('#modalTags');
  var modalStack = $('#carouselStack');
  var modalThumbs = $('#modalThumbs');
  var modalPrev = $('#modalPrev');
  var modalNext = $('#modalNext');
  var modalClose = $('#modalClose');
  var slideObserver = null;
  var isPortraitStrip = function () { return window.innerWidth <= 640; };

  // scrollLeft that would centre `slide` inside the strip (rect-based:
  // correct regardless of CSS offsetParent quirks)
  function stripCenterLeft(slide) {
    var sRect = slide.getBoundingClientRect();
    var nRect = modalStack.getBoundingClientRect();
    return modalStack.scrollLeft + (sRect.left - nRect.left) - (nRect.width - sRect.width) / 2;
  }

  function fillModalTexts(project, resetHtml) {
    modalCategory.textContent = project.category.toUpperCase();
    modalTitle.textContent = projectField(project, 'title');
    modalDesc.textContent = projectField(project, 'description');

    if (resetHtml !== false) {
      modalTags.innerHTML = '';
      (project.technologies || []).forEach(function (tech) {
        var tag = document.createElement('span');
        tag.className = 'modal-tag';
        tag.textContent = tech;
        modalTags.appendChild(tag);
      });
    }
  }

  function openProjectModal(project) {
    state.modalProject = project;
    state.modalIndex = 0;

    fillModalTexts(project, true);

    modalStack.innerHTML = '';
    modalThumbs.innerHTML = '';
    slideObserver && slideObserver.disconnect();
    slideObserver = null;

    var images = project.images || [];
    var alt = project.alt || projectField(project, 'title');

    images.forEach(function (img, index) {
      var slide = document.createElement('div');
      slide.className = 'carousel-slide';
      slide.innerHTML =
        '<button type="button" aria-label="' + esc(t('view-large').replace('{n}', index + 1)) + '">' +
        '<img alt="' + esc(alt + ' — ' + (index + 1)) + '" width="' + img.fw + '" height="' + img.fh +
        '" loading="' + (index === 0 ? 'eager' : 'lazy') + '" decoding="async">' +
        '</button>';
      slide.querySelector('button').addEventListener('click', function () {
        openImageViewer(project.images, index);
      });
      modalStack.appendChild(slide);

      var thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'carousel-thumb';
      thumb.innerHTML = '<img src="' + img.t + '" alt="" width="' + img.w + '" height="' + img.h +
        '" loading="lazy" decoding="async">';
      thumb.addEventListener('click', function () { goToSlide(index, 'instant'); });
      modalThumbs.appendChild(thumb);
    });

    if (isPortraitStrip()) { setupStripObserver(); }
    goToSlide(0);

    modal.classList.add('active');
    var modalContent = modal.querySelector('.project-modal-content');
    modalContent.classList.add('sheet-open');
    lockScroll();
    modalClose.focus();
  }

  function closeProjectModal() {
    var modalContent = modal.querySelector('.project-modal-content');
    // A drag gesture leaves inline `animation: none` + a transform on the sheet.
    // Clear them first: running/filled animations override inline styles, so
    // without this reset the sheet-close CSS animation would never take over
    // (and the modal would stay visually stuck).
    modalContent.style.animation = '';
    modalContent.style.transform = '';
    modalContent.style.transition = '';
    modalContent.classList.remove('sheet-open');
    modalContent.classList.add('sheet-close');

    modalContent.addEventListener('animationend', function onEnd() {
      modalContent.removeEventListener('animationend', onEnd);
      finishModalClose();
    }, { once: true });

    // Safety net in case animationend never fires
    setTimeout(finishModalClose, 400);

    slideObserver && slideObserver.disconnect();
    slideObserver = null;
  }

  // Single cleanup path shared by X/overlay close and swipe-down close.
  function finishModalClose() {
    if (!modal.classList.contains('active')) return;
    var modalContent = modal.querySelector('.project-modal-content');
    modalContent.classList.remove('sheet-open');
    modalContent.classList.remove('sheet-close');
    modalContent.style.transform = '';
    modalContent.style.transition = '';
    modalContent.style.animation = '';
    modalContent.style.willChange = '';
    modal.classList.remove('active');
    unlockScroll();
    state.modalProject = null;
    restoreFocus();
  }

  function restoreFocus() {
    if (state.anchor && document.contains(state.anchor)) state.anchor.focus();
    state.anchor = null;
  }

  function setAssignments(index) {
    // Load the full-size source for the active slide and its neighbours only.
    var slides = modalStack.children;
    for (var i = 0; i < slides.length; i++) {
      if (Math.abs(i - index) <= 1) {
        var imgEl = slides[i].querySelector('img');
        var source = state.modalProject.images[i];
        if (imgEl && source && imgEl.getAttribute('src') !== source.f) imgEl.setAttribute('src', source.f);
      }
    }
  }

  function setSlide(index) {
    state.modalIndex = index;
    $$('#carouselStack .carousel-slide').forEach(function (s, i) {
      s.classList.toggle('active', i === index);
    });
    $$('#modalThumbs .carousel-thumb').forEach(function (b, i) {
      b.setAttribute('aria-current', String(i === index));
      b.classList.toggle('active', i === index);
    });
    setAssignments(index);

    // Preload next image
    var images = state.modalProject ? state.modalProject.images : [];
    var nextIdx = (index + 1) % images.length;
    if (images[nextIdx]) {
      var preloadImg = new Image();
      preloadImg.src = images[nextIdx].f;
    }
  }

  function goToSlide(index) {
    var total = state.modalProject ? (state.modalProject.images || []).length : 0;
    if (!total) return;
    var next = (index + total) % total;
    if (isPortraitStrip() && modalStack.children[next]) {
      var target = modalStack.children[next];
      // Instant scroll for direct thumbnail navigation, smooth for one-step swipe
      var behavior = (arguments.length > 1 && arguments[1] === 'smooth') ? 'smooth' : 'instant';
      modalStack.scrollTo({ left: stripCenterLeft(target), behavior: behavior });
      setSlide(next);
    } else {
      setSlide(next);
    }
  }

  function setupStripObserver() {
    if (!('IntersectionObserver' in window)) return;
    slideObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var index = Array.prototype.indexOf.call(modalStack.children, entry.target);
        // Pure state-sync: positioning is owned by goToSlide / the drag controller
        if (index !== -1 && index !== state.modalIndex) setSlide(index);
      });
    }, { root: modalStack, threshold: 0.8 });
    Array.prototype.slice.call(modalStack.children).forEach(function (s) { slideObserver.observe(s); });
  }

  if (modal) {
    modalClose.addEventListener('click', closeProjectModal);
    modal.querySelector('.project-modal-overlay').addEventListener('click', closeProjectModal);
    modalPrev.addEventListener('click', function () { goToSlide(state.modalIndex - 1); });
    modalNext.addEventListener('click', function () { goToSlide(state.modalIndex + 1); });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!modal.classList.contains('active')) return;
        slideObserver && slideObserver.disconnect();
        slideObserver = null;
        if (isPortraitStrip()) { setupStripObserver(); goToSlide(state.modalIndex); }
      }, 200);
    }, { passive: true });

    // Swipe-down to close on mobile (drag handle + top bar)
    var modalContent = modal.querySelector('.project-modal-content');
    var modalTopBar = modal.querySelector('.modal-top-bar');
    var startY = 0;
    var isDragging = false;
    var THRESHOLD_PCT = 0.25;

    function onDragStart(e) {
      if (window.innerWidth > 640) return; // mobile-only gesture
      if (!e.target.closest('.modal-top-bar, .project-modal-header')) return;
      if (navigator.vibrate) navigator.vibrate(50);
      var touch = e.touches?.[0] || e;
      startY = touch.clientY;
      isDragging = true;
      // KEY: neutralize the `sheet-open ... forwards` fill-mode. While it stays
      // filled, the animation (not our inline style) owns `transform`, so the
      // sheet refuses to follow the finger. With it off, tracking is 1:1.
      modalContent.style.animation = 'none';
      modalContent.style.transition = 'none';
      modalContent.style.willChange = 'transform';
    }

    function onDragMove(e) {
      if (!isDragging) return;
      var touch = e.touches?.[0] || e;
      var deltaY = touch.clientY - startY;
      if (deltaY <= 0) return;
      e.preventDefault();
      e.stopPropagation();
      modalContent.style.transform = 'translateY(' + deltaY + 'px)';
    }

    function onDragEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      var touch = e.changedTouches?.[0] || e;
      var deltaY = touch.clientY - startY;
      var threshold = modalContent.offsetHeight * THRESHOLD_PCT;

      modalContent.style.transition = 'transform 0.3s var(--ease-out)';

      if (deltaY > threshold) {
        modalContent.style.transform = 'translateY(100%)';
        // The inline transition above performs the exit glide. Re-running
        // sheet-down would snap back to translateY(0) first (visible jump),
        // so skip the class animation and clean up once settled.
        setTimeout(finishModalClose, 320);
      } else {
        // Snap back to rest; clearing willChange lets the browser drop the layer
        modalContent.style.transform = '';
        modalContent.style.willChange = 'auto';
      }
    }

    // Grab zones: the top bar (drag handle) and the modal header (title row) —
    // matches the spec: swipe starts when grabbing the handle OR the header area.
    [modalTopBar, modal.querySelector('.project-modal-header')].forEach(function (el) {
      if (!el) return;
      el.addEventListener('touchstart', onDragStart, { passive: true });
      el.addEventListener('touchmove', onDragMove, { passive: false });
      el.addEventListener('touchend', onDragEnd);
      el.addEventListener('touchcancel', onDragEnd);
    });

    // --------------------------------------------------------------------
    // One-step horizontal swipe for the carousel strip (mobile only).
    // Browser-native horizontal panning/fling is disabled in CSS
    // (`touch-action: pan-y`); here we drive scrollLeft manually and clamp
    // the grab window to exactly the adjacent slide, so one gesture can
    // never advance by more than one image — whatever the speed/distance.
    // --------------------------------------------------------------------
    var stripDrag = {
      active: false, locked: false, moved: false,
      startX: 0, startY: 0, startScroll: 0,
      slideW: 0, startIndex: 0, prevBound: 0, nextBound: 0,
      lastX: 0, lastT: 0, totalDX: 0,
      samples: [] // recent touchmove samples for window-based flick velocity
    };

    function onStripStart(e) {
      if (window.innerWidth > 640 || stripDrag.active) return;
      var slides = modalStack.children;
      if (slides.length <= 1) return;
      var touch = e.touches?.[0];
      if (!touch) return;

      stripDrag.active = true;
      stripDrag.locked = false;
      stripDrag.moved = false;
      stripDrag.startX = touch.clientX;
      stripDrag.startY = touch.clientY;
      stripDrag.startScroll = modalStack.scrollLeft;
      stripDrag.lastX = touch.clientX;
      stripDrag.lastT = e.timeStamp;
      stripDrag.totalDX = 0;
      stripDrag.samples = [];

      // Physically centred slide right now — re-syncs any stale index
      var best = 0, bestDelta = Infinity;
      for (var i = 0; i < slides.length; i++) {
        var delta = Math.abs(stripCenterLeft(slides[i]) - modalStack.scrollLeft);
        if (delta < bestDelta) { bestDelta = delta; best = i; }
      }
      stripDrag.startIndex = best;
      stripDrag.slideW = slides[best].offsetWidth || 1;
      // Hard grab bounds: never beyond the adjacent slide
      stripDrag.prevBound = slides[best - 1] ? stripCenterLeft(slides[best - 1]) : stripCenterLeft(slides[best]);
      stripDrag.nextBound = slides[best + 1] ? stripCenterLeft(slides[best + 1]) : stripCenterLeft(slides[best]);
    }

    function onStripMove(e) {
      if (!stripDrag.active) return;
      var touch = e.touches?.[0];
      if (!touch) return;
      if (e.touches.length > 1) { stripDrag.locked = 'y'; return; } // multi-touch → abandon

      var dx = touch.clientX - stripDrag.startX;
      var dy = touch.clientY - stripDrag.startY;

      if (!stripDrag.locked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;        // dead zone → real taps unaffected
        stripDrag.locked = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }
      if (stripDrag.locked !== 'x') return;                      // vertical → native modal scroll

      e.preventDefault();                                        // the strip owns the horizontal pan now
      stripDrag.moved = true;
      stripDrag.totalDX = dx;
      stripDrag.lastX = touch.clientX;
      stripDrag.lastT = e.timeStamp;
      // Rolling sample history for window-based flick detection
      stripDrag.samples.push({ t: e.timeStamp, x: touch.clientX });
      if (stripDrag.samples.length > 12) stripDrag.samples.shift();

      var desired = stripDrag.startScroll - dx;
      // Rubber resistance beyond the ±1 window (cannot stack up more slides)
      if (desired < stripDrag.prevBound) desired = stripDrag.prevBound + (desired - stripDrag.prevBound) / 3;
      else if (desired > stripDrag.nextBound) desired = stripDrag.nextBound + (desired - stripDrag.nextBound) / 3;
      modalStack.scrollLeft = desired;
    }

    function onStripEnd(e) {
      if (!stripDrag.active) return;
      stripDrag.active = false;
      if (!stripDrag.moved) { stripDrag.locked = false; return; } // tap / untouched → native click
      stripDrag.moved = false;

      var touch = e.changedTouches?.[0];
      var endX = touch ? touch.clientX : stripDrag.lastX;
      var endT = e.timeStamp;

      // Flick velocity over the trailing ~90ms window (robust even when the
      // finger has already slowed before lifting, or when touchend lands on
      // the same coordinate as the last touchmove — the old single-segment
      // formula produced v ≈ 0 there and silently dropped short flicks).
      var oldest = stripDrag.samples.length ? stripDrag.samples[0] : { t: endT, x: endX };
      if (stripDrag.samples.length) {
        var winStart = endT - 90;
        for (var j = stripDrag.samples.length - 1; j >= 0; j--) {
          if (stripDrag.samples[j].t < winStart) break;
          oldest = stripDrag.samples[j];
        }
      }
      var dtWin = endT - oldest.t;
      var v = dtWin > 0 ? (endX - oldest.x) / dtWin : 0;

      var slides = modalStack.children;
      var from = stripDrag.startIndex;
      var displaced = modalStack.scrollLeft - stripCenterLeft(slides[from]);

      // Commit rule: a fast short flick wins, else 25% of one slide.
      // Either way: ±1 or stay — never more than one position per gesture.
      var dir = 0;
      if (v <= -0.5 && Math.abs(stripDrag.totalDX) > 8) dir = 1;
      else if (v >= 0.5 && Math.abs(stripDrag.totalDX) > 8) dir = -1;
      else if (displaced > stripDrag.slideW * 0.25) dir = 1;
      else if (displaced < -stripDrag.slideW * 0.25) dir = -1;

      var target = Math.min(slides.length - 1, Math.max(0, from + dir));
      goToSlide(target, 'smooth');
    }

    modalStack.addEventListener('touchstart', onStripStart, { passive: true });
    modalStack.addEventListener('touchmove', onStripMove, { passive: false });
    modalStack.addEventListener('touchend', onStripEnd);
    modalStack.addEventListener('touchcancel', onStripEnd);
  }

  // ------------------------------------------------------------------ viewer
  var viewer = $('#imageViewer');
  var viewerImg = $('#viewerImg');
  var viewerCounter = $('#viewerCounter');
  var viewerClose = $('#viewerClose');
  var viewerPrev = $('#viewerPrev');
  var viewerNext = $('#viewerNext');
  var viewerList = [];
  var viewerIndex = 0;
  var viewerAnchor = null;

  // Ensure viewer starts closed on every load
  if (viewer) viewer.classList.remove('active');

  function openImageViewer(images, index) {
    if (!Array.isArray(images) || !images.length ||
        typeof index !== 'number' || index < 0 || index >= images.length) return;
    viewerAnchor = document.activeElement;
    viewerList = images;
    viewerIndex = index;
    viewerImg.src = images[index].f;
    viewerImg.removeAttribute('style');
    viewerCounter.textContent = (index + 1) + ' / ' + images.length;
    viewer.classList.add('active');
    viewer.classList.toggle('single', images.length <= 1);
    lockScroll();
    viewerClose.focus();
  }

  function closeImageViewer() {
    viewer.classList.remove('active');
    viewerImg.removeAttribute('src');
    if (viewerAnchor && document.contains(viewerAnchor)) viewerAnchor.focus();
    viewerAnchor = null;
    if (!(modal && modal.classList.contains('active'))) unlockScroll();
  }

  function viewerNav(dir) {
    if (!viewerList.length) return;
    viewerIndex = (viewerIndex + dir + viewerList.length) % viewerList.length;
    viewerImg.src = viewerList[viewerIndex].f;
    viewerCounter.textContent = (viewerIndex + 1) + ' / ' + viewerList.length;
  }

  if (viewer) {
    viewerClose.addEventListener('click', closeImageViewer);
    viewer.querySelector('.image-viewer-overlay').addEventListener('click', closeImageViewer);
    if (viewerPrev) viewerPrev.addEventListener('click', function () { viewerNav(-1); });
    if (viewerNext) viewerNext.addEventListener('click', function () { viewerNav(1); });
  }

  // ------------------------------------------------------- global keyboard
  document.addEventListener('keydown', function (e) {
    if (viewer && viewer.classList.contains('active')) {
      if (e.key === 'Escape') closeImageViewer();
      else if (e.key === 'ArrowLeft') viewerNav(-1);
      else if (e.key === 'ArrowRight') viewerNav(1);
      return;
    }

    if (modal && modal.classList.contains('active')) {
      if (e.key === 'Escape') closeProjectModal();
      else if (e.key === 'ArrowLeft') goToSlide(state.modalIndex - 1);
      else if (e.key === 'ArrowRight') goToSlide(state.modalIndex + 1);
      return;
    }

    if (typeof window.__closeMenu === 'function') {
      var overlay = $('#menuOverlay');
      if (overlay && overlay.classList.contains('open') && e.key === 'Escape') window.__closeMenu();
    }
  });

  // Focus trap: Tab stays inside whatever dialog is open.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var root = viewer.classList.contains('active') ? viewer
      : modal.classList.contains('active') ? modal : null;
    if (!root) return;
    var focusables = root.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });

  // ----------------------------------------------------------- marquee infinite (treadmill)
  function initInfiniteMarquee() {
    var marquee = $('.marquee');
    var track = marquee && marquee.querySelector('.marquee__track');
    if (!marquee || !track) return;

    var skills = Array.from(track.querySelectorAll('.skill'));
    if (!skills.length) return;

    var isPaused = false;
    var isDown = false;
    var startX;
    var scrollX = 0;
    var speed = 0.35;

    track.style.animation = 'none';
    marquee.style.cursor = 'grab';

    function gap() {
      return parseFloat(getComputedStyle(track).gap || '0');
    }

    function recycle() {
      var first = skills[0];
      var last = skills[skills.length - 1];
      var marqueeRect = marquee.getBoundingClientRect();

      // Merge stânga: primul skill a părăsit ecranul pe stânga -> mut-l la dreapta
      if (first) {
        var rect = first.getBoundingClientRect();
        if (rect.right <= 0) {
          track.appendChild(first);
          scrollX += first.offsetWidth + gap();
          skills.shift();
          skills.push(first);
        }
      }

      // Merge dreapta: scrollX > 0 înseamnă că am atras peste început -> mut ultimul la stânga
      if (scrollX > 0 && last) {
        track.insertBefore(last, skills[0] || track.firstChild);
        scrollX -= last.offsetWidth + gap();
        skills.pop();
        skills.unshift(last);
      }
    }

    function loop() {
      if (!isPaused && !isDown) {
        scrollX -= speed;
        recycle();
        track.style.transform = 'translateX(' + scrollX + 'px)';
      }
      requestAnimationFrame(loop);
    }

    loop();

    // Hover pause
    marquee.addEventListener('mouseenter', function () { isPaused = true; });
    marquee.addEventListener('mouseleave', function () { isPaused = false; });

    // Drag support
    function onDown(e) {
      isDown = true;
      marquee.style.cursor = 'grabbing';
      marquee.style.userSelect = 'none';
      startX = e.pageX || (e.touches && e.touches[0].pageX);
      e.preventDefault();
    }

    function onMove(e) {
      if (!isDown) return;
      var x = e.pageX || (e.touches && e.touches[0].pageX);
      var walk = (x - startX) * 1.5;
      scrollX += walk;
      startX = x;
      recycle();
      track.style.transform = 'translateX(' + scrollX + 'px)';
    }

    function onUp() {
      isDown = false;
      marquee.style.cursor = 'grab';
      marquee.style.userSelect = '';
    }

    marquee.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mouseleave', onUp);

    marquee.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
  }

  // ------------------------------------------------------------------ boot
  function initApp() {
    applyI18n();
    initLanguageSwitcher();
    initMenu();
    initFilters();
    initFilterStrip();
    initReveal();
    initInfiniteMarquee();

    $('#showMoreBtn').addEventListener('click', showMore);
    $('#showLessBtn').addEventListener('click', showLess);
    renderProjects();
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadProjects);
  } else {
    loadProjects();
  }
})();
