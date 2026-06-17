/**
 * theme.js
 * Handles the Dark/Light mode theme logic for the WMS STOCKA portal.
 */

// 1. Get preferred theme
const getPreferredTheme = () => {
  const savedTheme = localStorage.getItem('stocka-theme');
  if (savedTheme) {
    return savedTheme;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

// 2. Apply theme immediately to prevent FOUC
const setTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('stocka-theme', theme);
};

let currentTheme = getPreferredTheme();
setTheme(currentTheme);

// Initialize UI toggles once DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const themeToggleBtns = document.querySelectorAll('.theme-toggle-btn');

  // 4. Toggle function
  const handleToggle = () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(currentTheme);
  };

  // 5. Attach event listeners
  themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleToggle();
    });
  });

  // Listen for system theme changes if no local storage is strictly overriding
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('stocka-theme')) {
      const newTheme = e.matches ? 'dark' : 'light';
      currentTheme = newTheme;
      setTheme(newTheme);
    }
  });
  // Expand the clickable area of date inputs to trigger calendar picker anywhere on the input
  document.addEventListener('click', (e) => {
    if (e.target.matches('input[type="date"]')) {
      try { e.target.showPicker(); } catch(err) {}
    }
  });
});
