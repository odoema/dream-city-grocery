(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const qs=s=>document.querySelector(s);
  const qsa=s=>Array.from(document.querySelectorAll(s));

  function addStyles(){
    if($('dc-audit-styles')) return;
    const s=document.createElement('style'); s.id='dc-audit-styles';
    s.textContent=`
      .dc-nav-group{margin:.85rem .75rem .35rem;font-size:.68rem;font-weight:800;letter-spacing:.12em;color:#98a2b3}
      .dc-flow-link{display:inline-flex;align-items:center;gap:.4rem;margin-top:.65rem;text-decoration:none}
      .dc-readiness{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;margin:0 0 1rem}
      .dc-readiness>div{border:1px solid #e4e7ec;border-radius:12px;padding:.8rem;background:#fff}
      .dc-readiness b{display:block}.dc-ready{color:#126747}.dc-notready{color:#b54708}
      .dc-next{margin-top:.9rem;padding:.85rem 1rem;border:1px solid #d9e9df;border-radius:12px;background:#f6f9f7}
      @media(max-width:760px){.dc-readiness{grid-template-columns:1fr}}
    `;
    document.head.appendChild(s);
  }

  function simplifyNavigation(){
    const labels={dashboard:'Home',pos:'Sell',inventory:'Stock',customers:'Customers',stocktake:'Count stock',purchases:'Buy & receive',accounting:'Money',reports:'Reports'};
    qsa('.nav[data-view]').forEach(b=>{
      const view=b.dataset.view;
      const span=b.querySelector('span');
      if(span&&labels[view]) span.textContent=labels[view];
      if(view==='purchases') b.title='Plan purchases, receive goods and pay suppliers';
      if(view==='stocktake') b.title='Count physical stock and reconcile differences';
    });
    const label=qs('.nav-label'); if(label) label.textContent='MAIN WORK';
  }

  function addPurchaseReadiness(){
    const v=$('purchases-view'); if(!v||v.querySelector('.dc-readiness')) return;
    const host=v.querySelector('.welcome'); if(!host) return;
    const box=document.createElement('div'); box.className='dc-readiness';
    box.innerHTML='<div><b>Supplier</b><span class="dc-help">Add at least one active supplier.</span></div><div><b>Products</b><span class="dc-help">Products must exist before buying.</span></div><div><b>Stock</b><span class="dc-help">Only receiving goods increases stock.</span></div>';
    host.insertAdjacentElement('afterend',box);
    const supplierBtn=$('add-supplier');
    if(supplierBtn) supplierBtn.textContent='＋ Add supplier';
    const po=$('create-purchase-order'); if(po) po.textContent='＋ Plan purchase';
    const receive=$('receive-supplier-invoice'); if(receive) receive.textContent='Receive goods';
  }

  function addStocktakeNextStep(){
    const v=$('stocktake-view'); if(!v||v.querySelector('.dc-next')) return;
    const guide=v.querySelector('.dc-count-guide'); if(!guide) return;
    const next=document.createElement('div'); next.className='dc-next';
    next.innerHTML='<b>Rule of thumb</b><div class="dc-help">If goods arrived today, finish <b>Buy & receive</b> first. If the shop is still selling or receiving goods, do not finish the count yet.</div><button type="button" class="secondary dc-flow-link" data-flow-purchases>Go to Buy & receive →</button>';
    guide.insertAdjacentElement('afterend',next);
    next.querySelector('[data-flow-purchases]').onclick=()=>{
      const b=qs('.nav[data-view="purchases"]'); if(b) b.click();
    };
  }

  function keepWorkflowHints(){
    const p=$('purchases-view');
    if(p){
      const notice=$('purchases-notice');
      if(notice && !notice.dataset.auditHint){
        notice.dataset.auditHint='1';
        notice.innerHTML='<b>Simple rule</b><span><strong>Plan</strong> when you are ordering. <strong>Receive</strong> when goods physically arrive. <strong>Pay</strong> when you settle the supplier. Only receiving goods changes stock.</span>';
      }
    }
    const s=$('stocktake-view');
    if(s){
      const n=s.querySelector('.notice');
      if(n && !n.dataset.auditHint){
        n.dataset.auditHint='1';
        n.innerHTML='<b>Count safely</b><span>Finish receiving first. Pause sales and receiving. Count every product, including zero. Review differences before <strong>Finish & post</strong>.</span>';
      }
    }
  }

  function run(){
    addStyles();
    simplifyNavigation();
    addPurchaseReadiness();
    addStocktakeNextStep();
    keepWorkflowHints();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run); else run();
  new MutationObserver(run).observe(document.body,{subtree:true,childList:true});
})();
