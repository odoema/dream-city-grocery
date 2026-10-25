// Public browser configuration for the dedicated Dream City Grocery Supabase project.
// This is a publishable public key; never use a service_role/secret key here.
window.DREAM_CITY_SUPABASE_CONFIG = {
  url: 'https://nohdgmylncjtdymfshfy.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vaGRnbXlsbmNqdGR5bWZzaGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3OTY5NTksImV4cCI6MjEwODM3Mjk1OX0.ZMwnchFy93lQY66Oh0bKaHKvhNhthFcjZkwk'
};

// Login/session stabilization: keep the dashboard hidden until app.js has
// resolved the current Supabase session. app.js then owns the final visibility
// state through the existing setSignedIn()/showView() logic.
(function () {
  var style = document.createElement('style');
  style.id = 'dream-city-auth-boot';
  style.textContent = '#dashboard-view{display:none!important}';
  document.head.appendChild(style);

  function release() {
    var auth = document.getElementById('auth-panel');
    var dashboard = document.getElementById('dashboard-view');
    if ((auth && auth.classList.contains('hidden')) || (dashboard && dashboard.classList.contains('hidden'))) {
      style.remove();
      return;
    }
    setTimeout(release, 50);
  }
  setTimeout(release, 0);
})();

// app.js expects window.supabase before it starts. Use the browser UMD build,
// not the package root, which is not guaranteed to expose a window global.
// Pin the version and provide a CDN fallback so a transient CDN reset does not
// leave the application with a missing Supabase client.
document.write('<script src="https://unpkg.com/@supabase/supabase-js@2.81.1/dist/umd/supabase.js" onerror="this.onerror=null;this.src=\'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.81.1/dist/umd/supabase.js\'"><\\/script>');

// Load optional usability and management layers after the core application.
// Product Intelligence is loaded explicitly by index.html, so do not load it again here.
// workflow-audit.js is intentionally not loaded in the browser because its old DOM observer
// could continually mutate the page. The existing application/database remain the source of truth.
setTimeout(function () {
  var simple = document.createElement('script');
  simple.src = 'simple-workflows-v2.js?v=3';
  simple.defer = true;
  document.head.appendChild(simple);
  simple.onload = function () {
    var smart = document.createElement('script');
    smart.src = 'smart-purchasing.js?v=2';
    smart.defer = true;
    document.head.appendChild(smart);
    smart.onload = function () {
      var posCatalogue = document.createElement('script');
      posCatalogue.src = 'pos-catalogue.js?v=2';
      posCatalogue.defer = true;
      document.head.appendChild(posCatalogue);
      posCatalogue.onload = function () {
        var manager = document.createElement('script');
        manager.src = 'product-manager.js?v=2';
        manager.defer = true;
        document.head.appendChild(manager);
      };
    };
  };
}, 0);
