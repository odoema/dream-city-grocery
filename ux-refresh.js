(() => {
  'use strict';

  const STYLE_ID = 'dream-city-ux-refresh';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Simplicity-first staff UX */
      .sidebar{width:228px;padding:18px 12px}
      .main{margin-left:228px}
      .nav-label{font-size:9px;letter-spacing:1.5px;padding:20px 11px 7px}
      .nav{padding:11px 12px;margin:1px 0;border-radius:9px}
      .nav span{font-size:12px}
      .nav-secondary{margin-top:2px}
      .nav-divider{height:1px;background:var(--line);margin:10px 8px 4px}
      .workspace-hint{margin:8px 8px 0;padding:10px 11px;border-radius:10px;background:#f5faf6;border:1px solid #e1eee4;color:#607568;font-size:10px;line-height:1.45}
      .workspace-hint b{display:block;color:#126747;font-size:10px;margin-bottom:2px}
      .topbar{height:82px;margin-bottom:21px}
      .top-actions{gap:9px}
      .date-pill{padding:7px 10px}
      .welcome{margin-bottom:16px}
      .welcome .primary{min-height:40px}
      .panel{border-radius:14px}
      .metric{border-radius:14px}
      .quick-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 18px}
      .quick-action{display:flex;align-items:center;gap:11px;padding:13px 14px;background:#fff;border:1px solid var(--line);border-radius:12px;color:var(--ink);text-align:left;cursor:pointer;box-shadow:var(--shadow);transition:.16s ease}
      .quick-action:hover{transform:translateY(-1px);border-color:#b8d6c2}
      .quick-action .qa-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:9px;background:#eaf5ed;color:#126747;font-weight:900;font-size:15px;flex:0 0 auto}
      .quick-action b{display:block;font-size:11px;color:#18392b}
      .quick-action small{display:block;font-size:9px;color:#8a968e;margin-top:2px}
      .task-banner{display:flex;align-items:center;justify-content:space-between;gap:15px;background:linear-gradient(90deg,#eef8f1,#fff);border:1px solid #dcecdf;border-radius:14px;padding:14px 16px;margin-bottom:18px}
      .task-banner b{display:block;font-size:12px;color:#164a34}
      .task-banner span{display:block;color:#75847a;font-size:10px;margin-top:3px}
      .task-banner .task-actions{display:flex;gap:7px;flex-wrap:wrap}
      .task-banner button{border:1px solid #d6e5da;background:#fff;border-radius:8px;padding:8px 10px;color:#126747;font-weight:800;font-size:10px;cursor:pointer}
      .task-banner button:hover{background:#f4faf5}
      .pos-layout{grid-template-columns:minmax(0,1.6fr) minmax(330px,.8fr)}
      .products-panel .panel-heading{position:sticky;top:0;background:#fff;z-index:2;padding-bottom:5px}
      .cart-panel{top:12px}
      .cart-panel .total-row strong{font-size:21px}
      .product-card{border-radius:12px;padding:14px;transition:.15s ease}
      .product-card:hover{transform:translateY(-1px);box-shadow:0 7px 18px rgba(20,103,71,.07)}
      .product-card:disabled{opacity:.55;cursor:not-allowed;transform:none}
      .product-card .product-emoji{background:#f2f7f3}
      .search{min-height:42px}
      .cart-summary .primary{min-height:44px;font-size:13px}
      .workflow-step{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #f0f3f1}
      .workflow-step:last-child{border-bottom:0}
      .workflow-step .step-no{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#eaf5ed;color:#126747;font-size:10px;font-weight:900;flex:0 0 auto}
      .workflow-step b{font-size:11px;display:block;color:#244233}.workflow-step small{display:block;color:#8b978f;font-size:9px;margin-top:2px}
      @media(max-width:1150px){.sidebar{width:205px}.main{margin-left:205px}.quick-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:720px){
        .sidebar{width:62px;padding:12px 6px}.main{margin-left:62px;padding:0 12px}.nav{padding:13px 0;justify-content:center}.nav span,.nav-label,.workspace-hint,.nav-divider{display:none}.brand{padding-bottom:15px}.brand img{width:58px;height:58px}
        .quick-actions{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.quick-action{padding:11px}.quick-action small{display:none}.task-banner{display:block}.task-banner .task-actions{margin-top:9px}.topbar{height:72px}
      }
    `;
    document.head.appendChild(style);
  }

  function renameNavigation() {
    const labels = {
      dashboard: ['Home', 'Start here'],
      pos: ['Sell', 'Make a sale'],
      inventory: ['Stock', 'Products & stock'],
      customers: ['Customers', 'Credit & contacts'],
      stocktake: ['Count stock', 'Physical count'],
      purchases: ['Buy', 'Purchases & receiving'],
      accounting: ['Accounts', 'Money & records'],
      reports: ['Reports', 'Management view']
    };
    document.querySelectorAll('.nav[data-view]').forEach(nav => {
      const pair = labels[nav.dataset.view];
      if (!pair) return;
      const span = nav.querySelector('span');
      if (span) span.textContent = pair[0];
      nav.title = pair[1];
    });
  }

  function addSidebarHint() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.querySelector('.workspace-hint')) return;
    const hint = document.createElement('div');
    hint.className = 'workspace-hint';
    hint.innerHTML = '<b>Simple rule</b>Record what happened. The system handles the numbers.';
    const bottom = sidebar.querySelector('.sidebar-bottom');
    if (bottom) sidebar.insertBefore(hint, bottom);
  }

  function addQuickActions() {
    const dashboard = document.getElementById('dashboard-view');
    if (!dashboard || dashboard.querySelector('.quick-actions')) return;
    const anchor = dashboard.querySelector('.notice');
    const wrap = document.createElement('div');
    wrap.className = 'quick-actions';
    const actions = [
      ['pos','＋','Sell','Start a sale'],
      ['purchases','↓','Buy','Record a purchase'],
      ['stocktake','✓','Count stock','Check shelves'],
      ['inventory','▦','Stock','Find a product']
    ];
    wrap.innerHTML = actions.map(([view,icon,title,sub]) => `<button type="button" class="quick-action" data-ux-goto="${view}"><span class="qa-icon">${icon}</span><span><b>${title}</b><small>${sub}</small></span></button>`).join('');
    if (anchor) anchor.parentNode.insertBefore(wrap, anchor); else dashboard.prepend(wrap);
    wrap.querySelectorAll('[data-ux-goto]').forEach(btn => btn.addEventListener('click', () => {
      const nav = document.querySelector(`.nav[data-view="${btn.dataset.uxGoto}"]`);
      if (nav) nav.click();
      else if (typeof window.showView === 'function') window.showView(btn.dataset.uxGoto);
    }));
  }

  function addTaskBanner() {
    const dashboard = document.getElementById('dashboard-view');
    if (!dashboard || dashboard.querySelector('.task-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'task-banner';
    banner.innerHTML = '<div><b>Today\'s shop flow</b><span>Sell → Buy → Receive → Count → Review. Use the simplest path for the job.</span></div><div class="task-actions"><button type="button" data-ux-goto="pos">Sell</button><button type="button" data-ux-goto="purchases">Buy</button><button type="button" data-ux-goto="stocktake">Count</button></div>';
    const quick = dashboard.querySelector('.quick-actions');
    if (quick) quick.parentNode.insertBefore(banner, quick.nextSibling);
    banner.querySelectorAll('[data-ux-goto]').forEach(btn => btn.addEventListener('click', () => document.querySelector(`.nav[data-view="${btn.dataset.uxGoto}"]`)?.click()));
  }

  function addSectionHints() {
    const hints = {
      'pos-view': ['SELL', 'Scan/search → add items → choose payment → complete sale.'],
      'purchases-view': ['BUY', 'Record what was actually bought. Receive goods before they become stock.'],
      'stocktake-view': ['COUNT STOCK', 'Count what is physically on the shelf. Approve only after the count is complete.'],
      'inventory-view': ['STOCK', 'Live stock is the truth. Legacy catalogue information is reference only.']
    };
    Object.entries(hints).forEach(([id,[kicker,text]]) => {
      const view = document.getElementById(id);
      if (!view || view.querySelector('.ux-section-hint')) return;
      const welcome = view.querySelector('.welcome');
      if (!welcome) return;
      const h = document.createElement('div');
      h.className = 'ux-section-hint muted';
      h.style.cssText = 'font-size:10px;margin:-10px 0 14px;color:#738279;';
      h.innerHTML = `<b style="color:#126747;letter-spacing:1px;font-size:9px;">${kicker}</b> · ${text}`;
      welcome.parentNode.insertBefore(h, welcome.nextSibling);
    });
  }

  function init() {
    injectStyles();
    renameNavigation();
    addSidebarHint();
    addQuickActions();
    addTaskBanner();
    addSectionHints();
  }

  const observer = new MutationObserver(() => {
    renameNavigation();
    addSidebarHint();
    addQuickActions();
    addTaskBanner();
    addSectionHints();
  });

  function start() {
    init();
    observer.observe(document.body, {subtree:true, childList:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
