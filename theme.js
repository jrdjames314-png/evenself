/* apply saved / system theme before first paint (external file so the CSP needs no inline scripts) */
(function () { try { var t = localStorage.getItem('evenself-theme'); if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; document.documentElement.dataset.theme = t; } catch (e) { document.documentElement.dataset.theme = 'dark'; } })();
