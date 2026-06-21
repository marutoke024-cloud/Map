// Awwwards-style intro loader: the "SPOTS" wordmark fills with liquid as the
// real asset progress climbs 0→100%. The liquid level rises (eased) and its
// surface ripples; a curtain then reveals the map.
import { gsap } from 'gsap';

const $ = (id) => document.getElementById(id);
const VB_H = 300; // svg viewBox height

// A wavy-topped liquid body that fills downward from y≈0; we translate the whole
// group up as the level rises. Spans well beyond the text so horizontal drift
// never reveals an edge.
function wavePath(amp = 13, wl = 150) {
  let d = `M -600 0`;
  for (let x = -600; x <= 1600; x += 15) d += ` L ${x} ${(Math.sin(x / (wl / (2 * Math.PI))) * amp).toFixed(2)}`;
  d += ` L 1600 ${VB_H} L -600 ${VB_H} Z`;
  return d;
}

export function createLoader() {
  const numEl = $('loader-num');
  const statusEl = $('loader-status');
  const liquid = $('lp-liquid');
  const wave = $('lp-wave');
  wave.setAttribute('d', wavePath());
  wave.setAttribute('fill', 'url(#lp-grad)');

  let target = 0;
  let shown = 0;
  let raf = null;

  const tick = () => {
    shown += (target - shown) * 0.07;
    const p = shown;
    numEl.textContent = Math.round(p * 100);
    // level rises: at p=0 group is pushed fully down (empty), at p=1 it sits at 0 (full)
    liquid.setAttribute('transform', `translate(0 ${((1 - p) * (VB_H + 30)).toFixed(1)})`);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    set(p, label) {
      target = Math.max(target, Math.min(1, p));
      if (label) statusEl.textContent = label;
    },
    async finish() {
      target = 1;
      await new Promise((r) => {
        const wait = () => (shown > 0.99 ? r() : requestAnimationFrame(wait));
        wait();
      });
      numEl.textContent = '100';
      statusEl.textContent = 'welcome';
      cancelAnimationFrame(raf);
      liquid.setAttribute('transform', 'translate(0 0)');

      const loader = $('loader');
      const tl = gsap.timeline({ onComplete: () => loader.remove() });
      tl.to('.loader-stage', { autoAlpha: 0, y: -26, duration: 0.6, ease: 'power2.in' })
        .to('.loader-curtain', { scaleY: 1, duration: 0.7, ease: 'power4.inOut' }, '-=0.2')
        .set(loader, { background: 'transparent' })
        .set('.loader-grid', { autoAlpha: 0 })
        .to('.loader-curtain', { scaleY: 0, transformOrigin: 'top', duration: 0.8, ease: 'power4.inOut' }, '+=0.05');
      return tl;
    },
  };
}

export async function preload(loader, tasks) {
  let done = 0;
  const total = tasks.length;
  loader.set(0.04, 'connecting');
  await Promise.all(
    tasks.map(async (t) => {
      try {
        await t.run();
      } catch (e) {
        console.warn('preload failed:', t.label, e);
      }
      done += 1;
      loader.set(0.05 + (done / total) * 0.9, t.label);
    }),
  );
  loader.set(1, 'ready');
}
