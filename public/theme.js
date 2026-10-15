// Applies the saved theme before the first paint to avoid a light/dark flash.
try {
  var theme = JSON.parse(localStorage.getItem('tackle:theme') || '"system"');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) {}
