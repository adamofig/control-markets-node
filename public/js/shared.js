function createNavbar() {
  return `
    <nav class="navbar">
      <div class="nav-container">
        <a href="/" class="nav-logo">Notion Data Neat</a>
        <div class="nav-links">
          <a href="./db-entries.html">Get your DB entries</a>
          <a href="./integration-checker.html">Check access to your Notion</a>
          <a href="./search.html">Get your page content</a>
          <a href="https://github.com/dataclouder-dev/notion-data-neat" target="_blank">GitHub</a>
        </div>
      </div>
    </nav>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.insertAdjacentHTML('afterbegin', createNavbar());
}); 