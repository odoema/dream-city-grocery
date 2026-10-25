// Public browser configuration for the dedicated Dream City Grocery Supabase project.
// This is the project's legacy anon public key; never use a service_role/secret key here.
window.DREAM_CITY_SUPABASE_CONFIG = {
  url: 'https://nohdgmylncjtdymfshfy.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkb2hnbXlsbmNqdGR5bWZzaGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3OTY5NTksImV4cCI6MjEwODM3Mjk1OX0.ZMwnchFy93tGZJbI2lQY66Oh0bKaHKvhNhthFcjZkwk'
};

// Load the usability, intelligence and product-management layers after the core application.
// The existing application/database remain the source of truth.
setTimeout(function () {
  var simple = document.createElement('script');
  simple.src = 'simple-workflows-v2.js?v=2';
  simple.defer = true;
  document.head.appendChild(simple);
  simple.onload = function () {
    var audit = document.createElement('script');
    audit.src = 'workflow-audit.js?v=1';
    audit.defer = true;
    document.head.appendChild(audit);
    audit.onload = function () {
      var smart = document.createElement('script');
      smart.src = 'smart-purchasing.js?v=1';
      smart.defer = true;
      document.head.appendChild(smart);
      smart.onload = function () {
        var intel = document.createElement('script');
        intel.src = 'product-intelligence.js?v=1';
        intel.defer = true;
        document.head.appendChild(intel);
        intel.onload = function () {
          var posCatalogue = document.createElement('script');
          posCatalogue.src = 'pos-catalogue.js?v=1';
          posCatalogue.defer = true;
          document.head.appendChild(posCatalogue);
          posCatalogue.onload = function () {
            var manager = document.createElement('script');
            manager.src = 'product-manager.js?v=1';
            manager.defer = true;
            document.head.appendChild(manager);
          };
        };
      };
    };
  };
}, 0);
