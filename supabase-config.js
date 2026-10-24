// Public browser configuration for the dedicated Dream City Grocery Supabase project.
// This is the project's legacy anon public key; never use a service_role/secret key here.
window.DREAM_CITY_SUPABASE_CONFIG = {
  url: 'https://nohdgmylncjtdymfshfy.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vaGRnbXlsbmNqdGR5bWZzaGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3OTY5NTksImV4cCI6MjEwODM3Mjk1OX0.ZMwnchFy93tGZJbI2lQY66Oh0bKaHKvhNhthFcjZkwk'
};

// Load the usability layer after the core application. The existing application logic
// remains the source of truth; this layer only makes the purchasing and stock-taking
// workflows easier to use.
setTimeout(function () {
  var script = document.createElement('script');
  script.src = 'simple-workflows-v2.js?v=1';
  script.defer = true;
  document.head.appendChild(script);
}, 0);
