'use strict';
/* Draftboard home page — live demo sizing, header shadow and scroll reveal. */
(() => {
  const demo = document.getElementById('demo');
  if (demo) {
    const viewport = demo.querySelector('.demo-viewport');
    const frame = viewport.querySelector('iframe');
    const cover = viewport.querySelector('.demo-cover');
    const fit = () => viewport.style.setProperty('--s', viewport.clientWidth / 1280);
    new ResizeObserver(fit).observe(viewport);
    fit();
    // The editor captures the mouse wheel, so it only becomes interactive after a click.
    cover.addEventListener('click', () => {
      cover.hidden = true;
      frame.focus();
    });
    demo.addEventListener('mouseleave', () => { cover.hidden = false; });
  }

  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { threshold: 0.12 });
  items.forEach(el => io.observe(el));
})();
