/**
 * On phones the panel sits below the map and the analyse bar is sticky at the
 * bottom, so suggestions opening under a search field end up off-screen. Move
 * the field's label to the top of the viewport when it gets focus.
 */
export function revealOnSmallScreen(input: HTMLElement) {
  if (!window.matchMedia("(max-width: 820px)").matches) return;
  const target = input.closest(".search") ?? input;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // After the on-screen keyboard has started to open.
  setTimeout(() => target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }), 150);
}
