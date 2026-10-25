// Public browser configuration for the dedicated Dream City Grocery Supabase project.
// This is a publishable public key; never use a service_role/secret key here.
window.DREAM_CITY_SUPABASE_CONFIG = {
  url: 'https://nohdgmylncjtdymfshfy.supabase.co',
  anonKey: 'sb_publishable_YeerBKReVu0NzhqleFJ4Kw_vkKLk92X'
};

// app.js expects the Supabase browser client to already exist. Load it synchronously
// while the HTML parser is still processing this file, so app.js can create its client.
document.write('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"><\\/script>');

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
