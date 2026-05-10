/**
 * Synchronous shell: header + footer match the URL before the module loads.
 * Keep ADMIN_NAV_LINKS in sync with `ADMIN_NAV_FALLBACK` in src/app.js.
 */
(function (global) {
  const ADMIN_NAV_LINKS = [
    { href: '/admin', label: 'Admin dashboard' },
    { href: '/upload', label: 'Local upload' },
    { href: '/review', label: 'Review queue' },
    { href: '/documents', label: 'Documents' },
    { href: '/profiles', label: 'Profiles' },
    { href: '/leads', label: 'Research leads' },
    { href: '/scanner', label: 'Scanner' },
    { href: '/health', label: 'Health' },
  ];

  const ADMIN_PATHS = new Set(ADMIN_NAV_LINKS.map((item) => item.href));

  function normPath(p) {
    return (p || '/').replace(/\/+$/, '') || '/';
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function buildAdminNav(path) {
    const menuLinks = ADMIN_NAV_LINKS.map((link) => {
      const cur = link.href === path ? ' aria-current="page"' : '';
      return `<a href="${esc(link.href)}" class="adminMenuLink"${cur}>${esc(link.label)}</a>`;
    }).join('');
    return `<details class="adminMenuDropdown">
      <summary class="adminMenuSummary"><span>Admin</span></summary>
      <div class="adminMenuPanel" role="navigation" aria-label="Admin tools">${menuLinks}</div>
    </details>`;
  }

  function buildPublicNav(path) {
    const cur = (href) => {
      if (href === '/' && path === '/') return ' aria-current="page"';
      if (href === '/submit' && (path === '/submit' || path === '/record-room-submit')) return ' aria-current="page"';
      if (href === '/search' && (path === '/search' || path === '/public-search')) return ' aria-current="page"';
      return '';
    };
    return `<a href="/"${cur('/')}>Home</a><a href="/submit"${cur('/submit')}>Submit records</a><a href="/search"${cur('/search')}>Public search</a>`;
  }

  function buildPublicFooter() {
    return `<div class="siteFooter-inner">
      <div class="siteFooter-brand">
        <strong class="siteFooter-title">The Record Room AI</strong>
        <p class="siteFooter-tagline">Document-driven accountability from official records — reviewed before publication.</p>
      </div>
      <nav class="siteFooter-nav" aria-label="Footer">
        <a href="/">Home</a>
        <a href="/submit">Submit records</a>
        <a href="/search">Public search</a>
        <a href="/admin">Staff workspace</a>
      </nav>
      <p class="siteFooter-legal">This site does not provide legal advice. Do not upload sealed or confidential records without authority. Allegations in filings are not the same as adjudicated findings.</p>
    </div>`;
  }

  function buildStaffFooter() {
    return `<div class="siteFooter-inner siteFooter-inner--staff">
      <div class="siteFooter-brand">
        <strong class="siteFooter-title">Staff workspace</strong>
        <p class="siteFooter-tagline">Use the Admin menu above for tools. Everything here is for intake and review — not the public site.</p>
      </div>
      <nav class="siteFooter-nav" aria-label="Staff footer">
        <a href="/">← Public site</a>
        <a href="/admin">Dashboard</a>
        <a href="/review">Review queue</a>
        <a href="/upload">Upload</a>
      </nav>
      <p class="siteFooter-legal">Authentication is not enabled yet; treat this area as trusted-team only.</p>
    </div>`;
  }

  function applySiteChrome(path) {
    path = normPath(path);
    const isAdmin = ADMIN_PATHS.has(path);
    const header = document.querySelector('.siteHeader');
    const nav = document.querySelector('.topNav');
    const actions = document.querySelector('#header-actions');
    const brand = document.querySelector('.brand');
    const footer = document.querySelector('#site-footer');
    if (!header || !nav || !actions) return;

    document.body.classList.toggle('admin-mode', isAdmin);
    header.classList.toggle('adminHeaderShell', isAdmin);
    header.classList.toggle('publicHeader', !isAdmin);

    if (brand) {
      brand.href = isAdmin ? '/admin' : '/';
    }

    nav.innerHTML = isAdmin ? buildAdminNav(path) : buildPublicNav(path);
    actions.innerHTML = isAdmin
      ? '<a href="/" class="headerExitLink">← Public site</a>'
      : '<a href="/admin" class="adminEntryBtn">Staff workspace</a>';

    if (footer) {
      footer.innerHTML = isAdmin ? buildStaffFooter() : buildPublicFooter();
      footer.classList.toggle('siteFooter--staff', isAdmin);
    }

    document.documentElement.classList.add('shell-ready');
  }

  global.__RR_ADMIN_NAV_LINKS__ = ADMIN_NAV_LINKS;
  global.__RR_ADMIN_PATHS__ = ADMIN_PATHS;
  global.__RR_applySiteChrome = applySiteChrome;

  applySiteChrome(typeof location !== 'undefined' ? location.pathname : '/');
})(typeof window !== 'undefined' ? window : globalThis);
