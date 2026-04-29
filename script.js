/* Villa Strategica '26 — light interactions */

// ===== Scroll-reveal: stagger sections in as they come into view =====
(function () {
  const targets = document.querySelectorAll(
    '.section-head, .polaroid, .schedule li, .quarter, .q-card, .pool, .signoff'
  );
  targets.forEach((el) => el.classList.add('reveal'));

  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          // Stagger reveals slightly within a batch
          const target = entry.target;
          const delay = Math.min(i * 60, 240);
          setTimeout(() => target.classList.add('is-visible'), delay);
          io.unobserve(target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  targets.forEach((el) => io.observe(el));
})();

// ===== Draggable ducks — let users push C-suite around the pool =====
(function () {
  const pool = document.querySelector('.pool');
  if (!pool) return;
  const ducks = pool.querySelectorAll('.duck');

  ducks.forEach((duck) => {
    let dragging = false;
    let startX = 0, startY = 0;
    let baseLeft = 0, baseTop = 0;
    const poolRect = () => pool.getBoundingClientRect();

    const onDown = (e) => {
      dragging = true;
      duck.style.animation = 'none';
      duck.style.cursor = 'grabbing';
      duck.style.zIndex = '10';

      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;

      const rect = duck.getBoundingClientRect();
      const pRect = poolRect();
      baseLeft = rect.left - pRect.left;
      baseTop  = rect.top  - pRect.top;

      duck.style.left = baseLeft + 'px';
      duck.style.top  = baseTop  + 'px';
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!dragging) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      const pRect = poolRect();
      const duckRect = duck.getBoundingClientRect();
      const maxX = pRect.width  - duckRect.width;
      const maxY = pRect.height - duckRect.height;
      let nx = Math.max(0, Math.min(maxX, baseLeft + dx));
      let ny = Math.max(0, Math.min(maxY, baseTop  + dy));
      duck.style.left = nx + 'px';
      duck.style.top  = ny + 'px';
      duck.style.transform = `rotate(${Math.sin(dx / 30) * 12}deg)`;
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      duck.style.cursor = 'grab';
      duck.style.zIndex = '';
      // Resume bobbing from current position
      requestAnimationFrame(() => {
        duck.style.animation = '';
      });
    };

    duck.addEventListener('mousedown', onDown);
    duck.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  });
})();

// ===== Easter egg: konami-light (tap title 3x for a sun spin) =====
(function () {
  const title = document.querySelector('.hero-title');
  if (!title) return;
  let count = 0;
  let timer = null;
  title.addEventListener('click', () => {
    count++;
    clearTimeout(timer);
    timer = setTimeout(() => (count = 0), 800);
    if (count >= 3) {
      count = 0;
      const sun = document.querySelector('.sun-disc');
      if (!sun) return;
      sun.animate(
        [
          { transform: 'scale(1) rotate(0deg)' },
          { transform: 'scale(1.4) rotate(360deg)' },
          { transform: 'scale(1) rotate(720deg)' }
        ],
        { duration: 1400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
      );
    }
  });
})();
