(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const qs=s=>document.querySelector(s);
  const qsa=s=>Array.from(document.querySelectorAll(s));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let promptQueue=null;
  const nativePrompt=window.prompt.bind(window);
  let runningOriginal=false;

  function escapeHtml(value){return String(value??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));}
  function toast(m){const e=$('toast');if(e){e.textContent=m;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),3500);}}

  function injectStyles(){
    if($('dc-simple-styles')) return;
    const s=document.createElement('style'); s.id='dc-simple-styles';
    s.textContent=`
      .dc-help{font-size:.9rem;color:#667085;margin:.35rem 0 0}.dc-step{display:flex;gap:.7rem;align-items:flex-start;margin:.55rem 0}.dc-step b{display:grid;place-items:center;min-width:28px;height:28px;border-radius:50%;background:#126747;color:#fff;font-size:.82rem}.dc-hero{display:grid;grid-template-columns:1.25fr .75fr;gap:1rem;margin-bottom:1rem}.dc-action{display:flex;gap:.7rem;flex-wrap:wrap}.dc-action .primary{min-height:48px}.dc-kpi{border:1px solid #e4e7ec;border-radius:14px;padding:1rem;background:#fff}.dc-kpi strong{display:block;font-size:1.35rem}.dc-wizard{position:fixed;inset:0;background:rgba(16,24,40,.48);z-index:10000;display:grid;place-items:center;padding:1rem}.dc-wizard-card{width:min(900px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(16,24,40,.25);padding:1.35rem}.dc-wizard-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:1rem}.dc-wizard-head h2{margin:.1rem 0}.dc-wizard-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.dc-field label{display:block;font-weight:600;margin-bottom:.35rem}.dc-field input,.dc-field select{width:100%;min-height:44px;padding:.65rem .75rem;border:1px solid #d0d5dd;border-radius:10px}.dc-items{margin-top:1rem;border:1px solid #eaecf0;border-radius:12px;overflow:hidden}.dc-item{display:grid;grid-template-columns:1.6fr .65fr .85fr auto;gap:.6rem;align-items:end;padding:.75rem;border-bottom:1px solid #eaecf0}.dc-item:last-child{border-bottom:0}.dc-item small{display:block;color:#667085;margin-bottom:.3rem}.dc-item button{min-height:40px}.dc-wizard-foot{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1rem;padding-top:1rem;border-top:1px solid #eaecf0}.dc-callout{padding:.85rem 1rem;border-radius:12px;background:#f6f9f7;border:1px solid #d9e9df}.dc-count-guide{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;margin-bottom:1rem}.dc-count-guide>div{padding:.8rem;border:1px solid #eaecf0;border-radius:12px;background:#fff}.dc-count-guide b{display:block}.stocktake-save{min-width:92px}.stocktake-count-input{min-width:90px;font-size:1rem;font-weight:600}.dc-sticky{position:sticky;bottom:12px;z-index:20;margin-top:1rem;padding:.75rem;background:rgba(255,255,255,.94);border:1px solid #e4e7ec;border-radius:14px;box-shadow:0 8px 30px rgba(16,24,40,.12)}
      @media(max-width:760px){.dc-hero,.dc-wizard-grid,.dc-count-guide{grid-template-columns:1fr}.dc-item{grid-template-columns:1fr 1fr}.dc-item button{grid-column:1/-1}.dc-wizard-card{padding:1rem}}
    `;
    document.head.appendChild(s);
  }

  function modal(title, body, onConfirm, confirmText='Continue'){
    const old=$('dc-wizard'); if(old) old.remove();
    const wrap=document.createElement('div'); wrap.id='dc-wizard'; wrap.className='dc-wizard';
    wrap.innerHTML=`<div class="dc-wizard-card" role="dialog" aria-modal="true"><div class="dc-wizard-head"><div><p class="eyebrow">DREAM CITY · SIMPLE WORKFLOW</p><h2>${title}</h2></div><button type="button" class="secondary" data-close>Close</button></div><div>${body}</div><div class="dc-wizard-foot"><button type="button" class="secondary" data-close>Cancel</button><button type="button" class="primary" data-confirm>${confirmText}</button></div></div>`;
    document.body.appendChild(wrap);
    qsa('#dc-wizard [data-close]').forEach(b=>b.onclick=()=>wrap.remove());
    wrap.querySelector('[data-confirm]').onclick=async()=>{ const b=wrap.querySelector('[data-confirm]'); b.disabled=true; try{await onConfirm(wrap); wrap.remove();}catch(e){console.error(e);b.disabled=false;} };
    return wrap;
  }

  function getSuppliers(){
    return qsa('#purchase-suppliers tr').map(tr=>{const c=tr.querySelectorAll('td');return c.length>=4&&c[0].querySelector('b')?{name:c[0].innerText.trim(),active:c[3].innerText.trim().toLowerCase()==='active'}:null}).filter(Boolean).filter(x=>x.active);
  }
  function getProducts(){
    return qsa('#inventory-table tr').map(tr=>{const c=tr.querySelectorAll('td');if(c.length<8)return null;return {sku:c[0].innerText.trim(),name:c[1].innerText.trim(),stock:c[5].innerText.trim(),buy:c[3].innerText.replace(/[^0-9.-]/g,'')};}).filter(Boolean);
  }
  async function ensureInventoryRows(){
    const inv=$('inventory-table'); if(inv && inv.querySelector('tr td') && !/No products found/i.test(inv.innerText)) return getProducts();
    const nav=qs('[data-view="inventory"]'); const back=qs('[data-view="purchases"]'); if(nav){nav.click();await sleep(80);} const p=getProducts(); if(back) back.click(); return p;
  }
  function queuePrompts(values){promptQueue=values.slice();window.prompt=function(){return promptQueue.length?promptQueue.shift():null;};}
  function restorePrompt(){window.prompt=nativePrompt;promptQueue=null;}
  async function runPurchase(mode,data){
    const button=mode==='receive'?$('receive-supplier-invoice'):$('create-purchase-order'); if(!button)return;
    queuePrompts(data); runningOriginal=true;
    try{button.click();await sleep(700);}finally{runningOriginal=false;restorePrompt();}
  }

  async function openPurchaseWizard(mode){
    const suppliers=getSuppliers(); if(!suppliers.length){toast('Add an active supplier first.');return;}
    const products=await ensureInventoryRows(); if(!products.length){toast('Add products to Inventory first.');return;}
    const supplierOptions=suppliers.map((s,i)=>`<option value="${i}">${escapeHtml(s.name)}</option>`).join('');
    const productOptions=products.map((p,i)=>`<option value="${i}">${escapeHtml(p.name)} · ${escapeHtml(p.sku)}</option>`).join('');
    const isReceive=mode==='receive';
    const body=`<div class="dc-callout"><b>${isReceive?'Receiving goods':'Creating a purchase order'}</b><div class="dc-help">${isReceive?'Use this when goods have actually arrived. Stock is posted only after the final confirmation.':'Use this before delivery to tell the store what you intend to buy. It does not increase stock.'}</div></div>
      <div class="dc-wizard-grid" style="margin-top:1rem"><div class="dc-field"><label>Supplier</label><select id="dc-supplier">${supplierOptions}</select></div>${isReceive?`<div class="dc-field"><label>Invoice number</label><input id="dc-invoice" placeholder="e.g. INV-1042" required></div>`:`<div class="dc-field"><label>Expected delivery</label><input id="dc-expected" type="date"></div>`}</div>
      ${isReceive?`<div class="dc-wizard-grid" style="margin-top:1rem"><div class="dc-field"><label>Invoice date</label><input id="dc-invdate" type="date" value="${new Date().toISOString().slice(0,10)}"></div><div class="dc-field"><label>Payment due date <span class="muted">(optional)</span></label><input id="dc-duedate" type="date"></div></div>`:''}
      <div style="margin-top:1rem"><b>Items</b><p class="dc-help">Choose the product, enter quantity and cost. Add another line for another product.</p></div>
      <div class="dc-items" id="dc-items"><div class="dc-item"><div><small>Product</small><select class="dc-product">${productOptions}</select></div><div><small>Quantity</small><input class="dc-qty" type="number" min="0.01" step="0.01" value="1"></div><div><small>Unit cost (UGX)</small><input class="dc-cost" type="number" min="0" step="1" value="0"></div><button type="button" class="secondary dc-remove" disabled>Remove</button></div></div>
      <button type="button" class="secondary" id="dc-add-item" style="margin-top:.7rem">＋ Add another product</button>
      <div class="dc-help" style="margin-top:.8rem">${isReceive?'Receiving posts stock, inventory movement and supplier payable through the existing protected transaction.':'The purchase order is only a plan; stock changes when goods are received.'}</div>`;
    const w=modal(isReceive?'Receive goods — guided':'New purchase order — guided',body,async wrap=>{
      const supplier=Number(wrap.querySelector('#dc-supplier').value); const inv=isReceive?wrap.querySelector('#dc-invoice').value.trim():'';
      if(isReceive&&!inv){toast('Invoice number is required.');throw Error('validation');}
      const rows=qsa('#dc-items .dc-item'); const items=[];
      for(const row of rows){const pi=Number(row.querySelector('.dc-product').value);const qty=Number(row.querySelector('.dc-qty').value);const cost=Number(row.querySelector('.dc-cost').value);if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(cost)||cost<0){toast('Check every quantity and unit cost.');throw Error('validation');}items.push(`${products[pi].sku}:${qty}:${cost}`);}
      const prompts=[String(supplier+1)];
      if(isReceive){prompts.push(inv,wrap.querySelector('#dc-invdate').value||new Date().toISOString().slice(0,10),wrap.querySelector('#dc-duedate').value||'',items.join(';'),'','');}
      else{prompts.push(items.join(';'),wrap.querySelector('#dc-expected').value||'','');}
      await runPurchase(mode,prompts);
    },isReceive?'Receive & post goods':'Create purchase order');
    w.querySelector('#dc-add-item').onclick=()=>{const first=w.querySelector('.dc-item');const clone=first.cloneNode(true);clone.querySelector('.dc-qty').value='1';clone.querySelector('.dc-cost').value='0';clone.querySelector('.dc-remove').disabled=false;w.querySelector('#dc-items').appendChild(clone);qsa('#dc-items .dc-remove').forEach(b=>b.onclick=()=>b.closest('.dc-item').remove());};
  }

  function simplifyPurchases(){
    const v=$('purchases-view');if(!v)return;
    const head=v.querySelector('.welcome'); if(head){const actions=head.querySelector('.welcome > div:last-child');if(actions)actions.innerHTML='<button class="secondary" id="add-supplier" type="button">＋ Supplier</button> <button class="primary" id="create-purchase-order" type="button">＋ Plan purchase</button> <button class="primary" id="receive-supplier-invoice" type="button">Receive goods</button>';const h=head.querySelector('h2');if(h)h.textContent='Purchasing';const p=head.querySelector('p');if(p)p.textContent='Plan what you buy, then record what actually arrives.';}
    let guide=v.querySelector('.dc-purchase-guide');if(!guide){guide=document.createElement('div');guide.className='panel dc-purchase-guide';guide.innerHTML='<div class="panel-heading"><div><h3>How purchasing works</h3><p>Three simple steps — no accounting knowledge required.</p></div></div><div class="dc-hero"><div class="dc-kpi"><div class="dc-step"><b>1</b><div><strong>Plan purchase</strong><div class="dc-help">Use this when you are ordering from a supplier.</div></div></div><div class="dc-step"><b>2</b><div><strong>Receive goods</strong><div class="dc-help">Use this when the goods physically arrive. Stock increases here.</div></div></div><div class="dc-step"><b>3</b><div><strong>Pay supplier</strong><div class="dc-help">Record payment later from the invoice list.</div></div></div></div><div class="dc-kpi"><strong>Important</strong><div class="dc-help">A purchase order does <b>not</b> change stock. Receiving goods does.</div></div></div>';v.insertBefore(guide,v.children[1]);}
    const po=v.querySelector('#create-purchase-order');if(po&&!po.dataset.simpleBound){po.dataset.simpleBound='1';po.addEventListener('click',e=>{if(runningOriginal)return;e.preventDefault();e.stopImmediatePropagation();openPurchaseWizard('order');},true);}
    const rec=v.querySelector('#receive-supplier-invoice');if(rec&&!rec.dataset.simpleBound){rec.dataset.simpleBound='1';rec.addEventListener('click',e=>{if(runningOriginal)return;e.preventDefault();e.stopImmediatePropagation();openPurchaseWizard('receive');},true);}
  }

  function simplifyStocktake(){
    const v=$('stocktake-view');if(!v)return;
    const welcome=v.querySelector('.welcome');if(welcome){const h=welcome.querySelector('h2');if(h)h.textContent='Stock Taking';const p=welcome.querySelector('p');if(p)p.textContent='Count what is physically in the shop. Dream City calculates the difference for you.';const buttons=welcome.querySelector('div:last-child');if(buttons)buttons.innerHTML='<button class="secondary" id="refresh-stocktake" type="button">Refresh</button> <button class="primary" id="start-stocktake" type="button">＋ Start counting</button> <button class="secondary" id="cancel-stocktake" type="button" disabled>Cancel</button> <button class="primary" id="finalize-stocktake" type="button" disabled>Finish & post</button>';}
    const n=v.querySelector('.notice');if(n)n.innerHTML='<b>Before counting</b><span>First receive any new goods. Then stop sales and receiving until the count is finished. Count every product — use 0 when none is on the shelf.</span>';
    let guide=v.querySelector('.dc-count-guide');if(!guide){guide=document.createElement('div');guide.className='dc-count-guide';guide.innerHTML='<div><b>1. Start</b><span class="dc-help">Capture the system stock.</span></div><div><b>2. Count</b><span class="dc-help">Enter the physical quantity and save it.</span></div><div><b>3. Finish</b><span class="dc-help">Review the variance, then post the approved adjustment.</span></div>';const s=v.querySelector('#stocktake-summary');if(s)s.parentNode.insertBefore(guide,s);}
  }

  function observe(){simplifyPurchases();simplifyStocktake();const mo=new MutationObserver(()=>{simplifyPurchases();simplifyStocktake();});mo.observe(document.body,{subtree:true,childList:true});}
  function start(){injectStyles();observe();setTimeout(observe,500);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();