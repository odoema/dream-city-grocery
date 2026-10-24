// Public browser configuration for the dedicated Dream City Grocery Supabase project.
// This is the project's legacy anon public key; never use a service_role/secret key here.
window.DREAM_CITY_SUPABASE_CONFIG = {
  url: 'https://nohdgmylncjtdymfshfy.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJub2hkZ215bG5jamR5bWZzaGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3OTY5NTksImV4cCI6MjEwODM3Mjk1OX0.ZMwnchFy93tGZJbI2lQY66Oh0bKaHKvhNhthFcjZkwk'
};

// Load the usability layers after the core application. The existing application logic
// remains the source of truth; these layers simplify the workflow without replacing
// the protected database transactions.
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
  };
}, 0);
