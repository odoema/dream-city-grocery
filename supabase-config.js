// Public browser configuration for the dedicated Dream City Grocery Supabase project.
// This is the project's legacy anon public key; never use a service_role/secret key here.
window.DREAM_CITY_SUPABASE_CONFIG = {
  url: 'https://nohdgmylncjtdymfshfy.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vaGRnbXlsbmNqdGR5bWZzaGZ5IiwiaWF0IjoxNzkyNzk2OTU5LCJleHAiOjIxMDgzNzI5NTl9.ZMwnchFy93tGZJbI2lQY66Oh0bKaHKvhNhthFcjZkwk'
};

// Load the usability layer after the core application. The existing application logic
// remains the source of truth; this layer only makes the purchasing and stock-taking
// workflows easier to use.
setTimeout(function () {
  var script = document.createElement('script');
  script.src = 'simple-workflows.js?v=1';
  script.defer = true;
  document.head.appendChild(script);
}, 0);
