/**
 * RZVN — living sky starfield.
 * Layers: dust (tiny, breathing fades) + stars (medium, soft twinkle + drift).
 * Occasional subtle shooting stars. No parallax / no mouse coupling.
 * Respects prefers-reduced-motion.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('starfield');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var dust = [];    // many tiny stars — breathing fades
  var stars = [];   // medium stars — soft twinkle + drift
  var meteors = []; // shooting stars

  var running = false;
  var raf = 0;
  var last = 0;
  var DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  // Meteor scheduling
  var nextMeteor = 0; // seconds (clock time)

  // Mouse position for soft avoidance (canvas-space, CSS px)
  var mouseX = -99999;
  var mouseY = -99999;
  var AVOID_R = 130;    // repulsion radius px
  var AVOID_S = 110;    // max push speed px/s at cursor center

  function rand(min, max) { return min + Math.random() * (max - min); }

  function size() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.round(rect.width * DPR);
    var h = Math.round(rect.height * DPR);
    if (w < 2 || h < 2 || w > 16384 || h > 16384) return;
    canvas.width = w;
    canvas.height = h;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function seed() {
    var w = canvas.clientWidth || 1;
    var h = canvas.clientHeight || 1;
    var area = w * h;

    var dustCount = Math.round(Math.min(550, Math.max(300, area / 3000)));
    var starCount = Math.round(Math.min(120, Math.max(50, area / 14000)));

    dust = [];
    stars = [];
    meteors = [];
    nextMeteor = rand(5, 10); // first one fairly soon

    var i;

    // ---- Dust layer: tiny, breathing ----
    for (i = 0; i < dustCount; i++) {
      dust.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: rand(0.35, 0.85),
        base: rand(0.15, 0.45),
        // breath period 2–6 s expressed as angular speed
        pulseSpeed: (Math.PI * 2) / rand(2, 6),
        phase: Math.random() * Math.PI * 2,
        // how dark it can go at its dimmest (as fraction of base)
        floor: rand(0.15, 0.45),
        vx: 0, vy: 0
      });
      var dv = dust[dust.length - 1];
      var ang = Math.random() * Math.PI * 2;
      var spd = rand(4, 10); // px/s — visibly drifting, still calm
      dv.vx = Math.cos(ang) * spd;
      dv.vy = Math.sin(ang) * spd;
    }

    // ---- Stars layer: medium, soft twinkle + drift ----
    for (i = 0; i < starCount; i++) {
      var isStarShape = Math.random() < 0.3;
      var r = rand(1.0, 2.2);
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: r,
        base: rand(0.4, 0.75),
        pulseSpeed: (Math.PI * 2) / rand(3, 7),
        phase: Math.random() * Math.PI * 2,
        twinkleAmp: rand(0.1, 0.3),
        vx: 0, vy: 0,
        isStar: isStarShape,
        spikes: 4,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: rand(-0.06, 0.06) // rad/s — gentle
      });
      var sv = stars[stars.length - 1];
      var sang = Math.random() * Math.PI * 2;
      var sspd = rand(8, 18); // px/s — crosses screen in 1.5-3 min
      sv.vx = Math.cos(sang) * sspd;
      sv.vy = Math.sin(sang) * sspd;
    }
  }

  function drawStarShape(cx, cy, spikes, outerR, innerR, rotation) {
    var step = Math.PI / spikes;
    ctx.beginPath();
    var a0 = rotation;
    ctx.moveTo(cx + Math.cos(a0) * outerR, cy + Math.sin(a0) * outerR);
    for (var i = 0; i < spikes; i++) {
      var innerA = a0 + step;
      ctx.lineTo(cx + Math.cos(innerA) * innerR, cy + Math.sin(innerA) * innerR);
      a0 += step * 2;
      ctx.lineTo(cx + Math.cos(a0) * outerR, cy + Math.sin(a0) * outerR);
    }
    ctx.closePath();
    ctx.fill();
  }

  function spawnMeteor(w, h, t) {
    // Enters from a random top-ish edge, travels on a shallow diagonal
    var fromLeft = Math.random() < 0.5;
    var speed = rand(500, 800); // px/s
    var angle = fromLeft ? rand(0.55, 0.75) : Math.PI - rand(0.55, 0.75);
    meteors.push({
      x: fromLeft ? rand(-40, w * 0.35) : rand(w * 0.65, w + 40),
      y: rand(0, h * 0.45),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      ttl: rand(0.7, 1.1) // seconds — brief
    });
    nextMeteor = t + rand(8, 20);
  }

  function paint(t, dt) {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    var i, s;

    // ---------- dust: breathing ----------
    ctx.fillStyle = '#fff';
    for (i = 0; i < dust.length; i++) {
      s = dust[i];
      if (dt) {
        // soft avoidance from cursor
        var adx = s.x - mouseX, ady = s.y - mouseY;
        var ad2 = adx * adx + ady * ady;
        if (ad2 < AVOID_R * AVOID_R && ad2 > 0.01) {
          var ad = Math.sqrt(ad2);
          var f = 1 - ad / AVOID_R;
          var push = f * f * AVOID_S * dt;
          s.x += (adx / ad) * push;
          s.y += (ady / ad) * push;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x < -2) s.x = w + 2; else if (s.x > w + 2) s.x = -2;
        if (s.y < -2) s.y = h + 2; else if (s.y > h + 2) s.y = -2;
      }
      // 0..1 breathing wave (sin), then eased between floor..1
      var wave = 0.5 + 0.5 * Math.sin(s.phase + t * s.pulseSpeed);
      var alpha = s.base * (s.floor + (1 - s.floor) * wave);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.2832);
      ctx.fill();
    }

    // ---------- stars: soft twinkle + drift ----------
    for (i = 0; i < stars.length; i++) {
      s = stars[i];
      if (dt) {
        // soft avoidance from cursor
        var sdx = s.x - mouseX, sdy = s.y - mouseY;
        var sd2 = sdx * sdx + sdy * sdy;
        if (sd2 < AVOID_R * AVOID_R && sd2 > 0.01) {
          var sd = Math.sqrt(sd2);
          var sf = 1 - sd / AVOID_R;
          var spush = sf * sf * AVOID_S * dt;
          s.x += (sdx / sd) * spush;
          s.y += (sdy / sd) * spush;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x < -3) s.x = w + 3; else if (s.x > w + 3) s.x = -3;
        if (s.y < -3) s.y = h + 3; else if (s.y > h + 3) s.y = -3;
        if (s.isStar) s.rotation += s.rotSpeed * dt;
      }
      var tw = 1 - s.twinkleAmp * (0.5 + 0.5 * Math.sin(s.phase + t * s.pulseSpeed));
      ctx.globalAlpha = s.base * tw;

      if (s.isStar) {
        drawStarShape(s.x, s.y, s.spikes, s.r, s.r * 0.38, s.rotation);
      } else {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fill();
      }
    }

    // ---------- meteors: brief, subtle streaks ----------
    if (!reduced && dt && t > nextMeteor && meteors.length < 2) {
      spawnMeteor(w, h, t);
    }
    for (i = meteors.length - 1; i >= 0; i--) {
      var m = meteors[i];
      m.life += dt;
      if (m.life >= m.ttl) { meteors.splice(i, 1); continue; }
      m.x += m.vx * dt;
      m.y += m.vy * dt;

      // fade in fast, fade out slow-ish; capped soft
      var p = m.life / m.ttl;                       // 0..1
      var fade = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
      var tail = 90;                                // streak length px
      var nx = m.vx, ny = m.vy;
      var norm = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= norm; ny /= norm;
      ctx.globalAlpha = Math.max(0, fade * 0.8);
      var grad = ctx.createLinearGradient(
        m.x, m.y, m.x - nx * tail, m.y - ny * tail
      );
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - nx * tail, m.y - ny * tail);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!running) return;
    var t = now / 1000;
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    paint(t, dt);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }

  var started = false;

  function startWhenReady() {
    if (started) return;
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
      started = true;
      start();
    }
  }

  size();
  seed();

  if ('ResizeObserver' in window) {
    new ResizeObserver(function () {
      size();
      seed();
      if (reduced) paint(0, 0);
      if (!reduced) startWhenReady();
    }).observe(canvas);
  }

  if (reduced) {
    paint(0, 0); // one calm static frame
  } else {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) startWhenReady();
      }, { threshold: 0.02 }).observe(canvas);
    }
    requestAnimationFrame(startWhenReady);
    setTimeout(startWhenReady, 150);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else if (started) start();
      else startWhenReady();
    });

    // Soft avoidance: track pointer anywhere; map to canvas space
    function setPointer(cx, cy) {
      var rect = canvas.getBoundingClientRect();
      var mx = cx - rect.left;
      var my = cy - rect.top;
      if (mx < -AVOID_R || mx > rect.width + AVOID_R ||
          my < -AVOID_R || my > rect.height + AVOID_R) {
        mouseX = -99999; mouseY = -99999;
      } else {
        mouseX = mx; mouseY = my;
      }
    }
    window.addEventListener('mousemove', function (e) {
      setPointer(e.clientX, e.clientY);
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches.length) setPointer(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchend', function () {
      mouseX = -99999; mouseY = -99999;
    }, { passive: true });
  }

  var timer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      size();
      seed();
      if (reduced) paint(0, 0);
    }, 150);
  }, { passive: true });
})();
