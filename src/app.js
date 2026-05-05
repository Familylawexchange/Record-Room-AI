const app = document.querySelector('#app');

const routes = {
  '/': homePage,
  '/submit': submitPage,
  '/documents': documentsPage,
  '/admin': adminPage,
  '/health': healthPage,
  '/upload': uploadPage,
  '/review': reviewPage,
  '/profiles': profilesPage,
  '/leads': leadsPage,
  '/scanner': scannerPage,
  '/search': searchPage,
};

bootstrap();

function bootstrap() {
  hydrateDirectVisitFromQuery();
  wireNavigation();
  renderRoute(location.pathname);
}

function hydrateDirectVisitFromQuery() {
  const params = new URLSearchParams(location.search);
  const redirectedPath = params.get('p');

  if (!redirectedPath) return;

  const cleanPath = redirectedPath.startsWith('/')
    ? redirectedPath
    : `/${redirectedPath}`;

  params.delete('p');

  const query = params.toString();

  const newUrl =
    `${cleanPath}${query ? `?${query}` : ''}${location.hash || ''}`;

  history.replaceState({}, '', newUrl);
}

function wireNavigation() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');

    if (!link) return;

    const url = new URL(link.href, location.origin);

    if (url.origin !== location.origin) return;

    event.preventDefault();

    navigate(url.pathname);
  });

  window.addEventListener('popstate', () => {
    renderRoute(location.pathname);
  });
}

function navigate(pathname) {
  if (pathname === location.pathname) return;

  history.pushState({}, '', pathname);

  renderRoute(pathname);
}

function renderRoute(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';

  const page = routes[normalized] || notFoundPage;

  app.innerHTML = page();

  document.title = `Record Room AI • ${titleForPath(normalized)}`;
}

function titleForPath(path) {
  const map = {
    '/': 'Home',
    '/submit': 'Submit',
    '/documents': 'Documents',
    '/admin': 'Admin',
    '/health': 'Health',
    '/upload': 'Upload',
    '/review': 'Review',
    '/profiles': 'Profiles',
    '/leads': 'Research Leads',
    '/scanner': 'Scanner',
    '/search': 'Search',
  };

  return map[path] || 'Not Found';
}

function panel(title, subtitle, bodyHtml) {
  return `
    <section class="panel">
      <h2>${title}</h2>
      <p>${subtitle}</p>
      ${bodyHtml}
    </section>
  `;
}

function homePage() {
  return panel(
    'Home',
    'Welcome to Record Room AI.',
    '<p>Use the navigation to explore routes.</p>'
  );
}

function submitPage() {
  return panel(
    'Public Submit',
    'Submit a public record.',
    '<p>/submit route is rendering correctly.</p>'
  );
}

function documentsPage() {
  return panel(
    'Documents',
    'Browse uploaded documents.',
    '<p>/documents route is rendering correctly.</p>'
  );
}

function adminPage() {
  return panel(
    'Admin Dashboard',
    'Internal moderation tools.',
    '<p>/admin route is rendering correctly.</p>'
  );
}

function healthPage() {
  return panel(
    'Health',
    'Frontend health check OK.',
    `<p><strong>Path:</strong> ${escapeHtml(location.pathname)}</p>`
  );
}

function uploadPage() {
  return panel(
    'Upload',
    'Local upload route.',
    '<p>/upload route is rendering correctly.</p>'
  );
}

function reviewPage() {
  return panel(
    'Review',
    'Review pending submissions.',
    '<p>/review route is rendering correctly.</p>'
  );
}

function profilesPage() {
  return panel(
    'Profiles',
    'Manage legal profiles.',
    '<p>/profiles route is rendering correctly.</p>'
  );
}

function leadsPage() {
  return panel(
    'Research Leads',
    'Track leads and verification.',
    '<p>/leads route is rendering correctly.</p>'
  );
}

function scannerPage() {
  return panel(
    'Scanner',
    'Scanner jobs and inspections.',
    '<p>/scanner route is rendering correctly.</p>'
  );
}

function searchPage() {
  return panel(
    'Search',
    'Search public records.',
    '<p>/search route is rendering correctly.</p>'
  );
}

function notFoundPage() {
  return `
    <section class="panel">
      <h2>404 — Page Not Found</h2>
      <p>
        The route
        <code>${escapeHtml(location.pathname)}</code>
        does not exist.
      </p>
      <p><a href="/">Return home</a></p>
    </section>
  `;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
