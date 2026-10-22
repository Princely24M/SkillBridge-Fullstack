(function () {
  const storageKey = 'skillbridge_theme';
  const root = document.documentElement;

  function readTheme() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateControls(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const nextTheme = theme === 'dark' ? 'light' : 'dark';
      button.textContent = `${nextTheme === 'dark' ? 'Dark' : 'Light'} mode`;
      button.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
  }

  function setTheme(theme, persist = true) {
    root.setAttribute('data-theme', theme);
    if (persist) {
      try {
        localStorage.setItem(storageKey, theme);
      } catch {
        // Theme remains applied for the current page when storage is unavailable.
      }
    }
    updateControls(theme);
  }

  setTheme(readTheme(), false);

  document.addEventListener('DOMContentLoaded', () => {
    updateControls(root.getAttribute('data-theme'));
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    const nextTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  });

  window.SkillBridgeTheme = {
    getTheme: () => root.getAttribute('data-theme'),
    setTheme
  };
})();