const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const vm = require('node:vm');

const themeScript = readFileSync(path.join(__dirname, '..', 'js', 'theme.js'), 'utf8');

function createThemeContext({ savedTheme = null, systemTheme = 'light' } = {}) {
  const listeners = {};
  const attributes = new Map();
  const buttonAttributes = new Map();
  let storedTheme = savedTheme;
  let buttonText = '';
  const button = {
    get textContent() {
      return buttonText;
    },
    set textContent(value) {
      buttonText = value;
    },
    setAttribute(name, value) {
      buttonAttributes.set(name, value);
    }
  };
  const document = {
    documentElement: {
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      getAttribute(name) {
        return attributes.get(name) || null;
      }
    },
    querySelectorAll() {
      return [button];
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    }
  };
  const localStorage = {
    getItem() {
      return storedTheme;
    },
    setItem(_key, value) {
      storedTheme = value;
    }
  };
  const window = {
    matchMedia() {
      return { matches: systemTheme === 'dark' };
    }
  };
  const context = vm.createContext({ document, localStorage, window });
  vm.runInContext(themeScript, context);

  return {
    button,
    buttonAttributes,
    listeners,
    localStorage: () => storedTheme,
    theme: () => attributes.get('data-theme')
  };
}

describe('Candidate theme controller', () => {
  it('restores a saved preference and persists an accessible toggle', () => {
    const theme = createThemeContext({ savedTheme: 'dark', systemTheme: 'light' });

    assert.equal(theme.theme(), 'dark');
    theme.listeners.click({ target: { closest: () => true } });
    assert.equal(theme.theme(), 'light');
    assert.equal(theme.localStorage(), 'light');
    assert.equal(theme.button.textContent, 'Dark mode');
    assert.equal(theme.buttonAttributes.get('aria-label'), 'Switch to dark theme');
    assert.equal(theme.buttonAttributes.get('aria-pressed'), 'false');
  });

  it('uses the operating system preference when no theme is saved', () => {
    const theme = createThemeContext({ systemTheme: 'dark' });

    assert.equal(theme.theme(), 'dark');
    assert.equal(theme.localStorage(), null);
  });
});
