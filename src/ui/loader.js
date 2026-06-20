// Awwwards-style intro loader: a real 0→100% counter driven by asset
// preloading, with an eased number, a filling hairline bar, and a curtain
// reveal that hands off to the map's fly-in.
import { gsap } from 'gsap';

const $ = (id) => document.getElementById(id);

export function createLoader() {
  const numEl = $('loader-num');
  const fillEl = $('loader-fill');
  const statusEl = $('loader-status');

  let target = 0; // real progress 0..1
  let shown = 0; // displayed progress (eased)
  let raf = null;

  const tick = () => {
    shown += (target - shown) * 0.08;
    if (shown > 0.999) shown = target >= 1 ? 1 : shown;
    const pct = Math.round(shown * 100);
    numEl.textContent = pct;
    fillEl.style.transform = `scaleX(${shown})`;
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
      // wait until the eased number visually reaches ~100
      await new Promise((r) => {
        const wait = () => (shown > 0.985 ? r() : requestAnimationFrame(wait));
        wait();
      });
      numEl.textContent = '100';
      fillEl.style.transform = 'scaleX(1)';
      statusEl.textContent = 'welcome';
      cancelAnimationFrame(raf);

      const loader = $('loader');
      const tl = gsap.timeline({
        onComplete: () => {
          loader.remove(); // fully remove so nothing from the loader can show through
        },
      });
      tl.to('.loader-inner', { autoAlpha: 0, y: -24, duration: 0.6, ease: 'power2.in' })
        .to('.loader-curtain', { scaleY: 1, duration: 0.7, ease: 'power4.inOut' }, '-=0.2')
        .set(loader, { background: 'transparent' })
        .set('.loader-grid', { autoAlpha: 0 })
        .to('.loader-curtain', { scaleY: 0, transformOrigin: 'top', duration: 0.8, ease: 'power4.inOut' }, '+=0.05');
      return tl;
    },
  };
}

/**
 * Run a set of async asset tasks while reporting progress to the loader.
 * `tasks` is an array of { label, run: () => Promise }.
 */
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
