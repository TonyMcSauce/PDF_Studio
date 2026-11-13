/* Runs before first paint so the page never flashes the wrong theme. */
(function () {
  try {
    var t = localStorage.getItem('pdfstudio-theme');
    if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
