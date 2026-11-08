// Colour themes. The colours themselves live in styles/themes.css; this is
// the list Settings offers and the code that switches between them.
// Loaded in <head>, before the page paints, so the saved theme applies
// without a flash of the default one.
(function () {
  const THEMES = [
    { id: 'moss', name: 'Moss and Bone' },
    { id: 'velvet', name: 'Velvet' },
    { id: 'slate', name: 'Slate' },
    { id: 'birch', name: 'Birch (light)' }
  ];
  const DEFAULT_THEME = 'moss';
  const STORAGE_KEY = 'antler:theme';

  function isKnown(id) {
    return THEMES.some(theme => theme.id === id);
  }

  /** A known theme id for any saved value, including the old 'dark'. */
  function normalize(id) {
    return isKnown(id) ? id : DEFAULT_THEME;
  }

  function apply(id) {
    const theme = normalize(id);
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not remembered for the next launch's first paint; settings still has it.
    }
    return theme;
  }

  function current() {
    return normalize(document.documentElement.dataset.theme);
  }

  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the default theme applies.
  }
  document.documentElement.dataset.theme = normalize(saved);

  window.AntlerThemes = { list: THEMES.slice(), DEFAULT_THEME, normalize, apply, current };
})();
