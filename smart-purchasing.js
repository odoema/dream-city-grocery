(function(){
  'use strict';

  const cfg = window.DREAM_CITY_SUPABASE_CONFIG || {};
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
  const fmtQty = v => Number(v || 0).toLocaleString('en-UG', {maximumFractionDigits:3});
  const fmtMoney = v => 'UGX ' + Math.round(Number(v || 0)).toLocaleString('en-UG');
  const toast = msg => { const e=document.getElementById('toast'); if(!e)return; e.textContent=msg; e.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>e.classList.remove('show'),3500); };
  let client = null;
  let currentRun = null;

  function getClient(){
    if(client) return client;
    if(!cfg.url || !cfg.anonKey || !window.supabase) return null;
    client = window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return client;
  }

  function styles(){
    if(document.getElementById('dc-smart-style')) return;
    const s=document.createElement('style'); s.id='dc-smart-style'; s.textContent=`
      .dc-smart{margin:0 0 1rem;background:#fff;border:1px solid #dfe5e1;border-radius:16px;padding:1rem;box-shadow:0 4px 18px rgba(16,24,40,.05)}
      .dc-smart-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.dc-smart h3{margin:.1rem 0}.dc-smart-help{color:#667085;font-size:.9rem}
      .dc-smart-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem}.dc-smart-table{margin-top:1rem;border:1px solid #eaecf0;border-radius:12px;overflow:auto}.dc-smart-row{display:grid;grid-template-columns:1.7fr .75fr .8fr .9fr .8fr;gap:.6rem;min-width:760px;padding:.7rem .8rem;border-bottom:1px solid #eaecf0;align-items:center}.dc-smart-row:last-child{border-bottom:0}.dc-smart-row.head{font-weight:700;background:#f8faf9}.dc-smart-row input{width:100%;min-height:38px;border:1px solid #d0d5dd;border-radius:8px;padding:.45rem}.dc-priority{font-size:.75rem;font-weight:700;text-transform:uppercase}.dc-priority.urgent{color:#b42318}.dc-priority.recommended{color:#027a48}.dc-smart-total{display:flex;justify-content:flex-end;font-weight:700;margin-top:.8rem}.dc-smart-note{margin-top:.8rem;padding:.7rem .8rem;border-radius:10px;background:#f8faf9;color:#475467;font-size:.88rem}
      @media(max-width:760px){.dc-smart-head{display:block}.dc-smart-actions{margin-top:.8rem}}
    `; document.head.appendChild(s);
  }

  async function rpc(name,args){
    const c=getClient(); if(!c) throw new Error('Supabase client is not ready');
    const {data,error}=await c.rpc(name,args||{}); if(error) throw error; return data;
  }

  function mount(){
    const v=document.getElementById('purchases-view'); if(!v) return;
    let box=document.getElementById('dc-smart-purchasing');
    if(box) return box;
    box=document.createElement('section'); box.id='dc-smart-purchasing'; box.className='dc-smart';
    box.innerHTML=`<div class="dc-smart-head"><div><p class="eyebrow">SMART PURCHASING</p><h3>Today's suggested shopping list</h3><div class="dc-smart-help">The system looks at recent sales, stock on hand and incoming stock. It recommends what may need buying — it never changes stock.</div></div><button class="primary" id="dc-smart-refresh">Calculate list</button></div><div id="dc-smart-body" class="dc-smart-note">Click <b>Calculate list</b> to see what the shop may need today.</div>`;
    const notice=v.querySelector('#purchases-notice');
    if(notice && notice.parentNode) notice.parentNode.insertBefore(box,notice); else v.prepend(box);
    document.getElementById('dc-smart-refresh').onclick=loadRecommendations;
    return box;
  }

  async function loadRecommendations(){
    const box=mount(), body=box.querySelector('#dc-smart-body');
    body.innerHTML='<div class="dc-smart-note">Calculating from live sales and stock data…</div>';
    try{
      const rows=await rpc('get_smart_purchase_recommendations');
      renderRows(rows||[]);
    }catch(e){
      console.error(e); body.innerHTML='<div class="dc-smart-note">The smart shopping model is prepared in the database but is not yet installed on the live project. No stock or accounting data was changed.</div>';
    }
  }

  function renderRows(rows){
    const body=document.getElementById('dc-smart-body');
    if(!rows.length){body.innerHTML='<div class="dc-smart-note"><b>No urgent purchases found.</b> Current stock and incoming stock cover the initial target, or there is not enough sales history yet.</div>';return;}
    body.innerHTML=`<div class="dc-smart-actions"><button class="primary" id="dc-smart-start">Create shopping list</button><span class="dc-smart-help">You can change quantities. A reason is required for material changes.</span></div><div class="dc-smart-table"><div class="dc-smart-row head"><div>Product</div><div>Stock</div><div>Demand/day</div><div>Suggested</div><div>Priority</div></div>${rows.map((r,i)=>`<div class="dc-smart-row" data-i="${i}"><div><b>${esc(r.product_name)}</b><div class="dc-smart-help">${esc(r.supplier_name||'Supplier not set')} · ${esc(r.reason||'')}</div></div><div>${fmtQty(r.quantity_on_hand)}<div class="dc-smart-help">${r.confirmed_incoming_qty?fmtQty(r.confirmed_incoming_qty)+' incoming':''}</div></div><div>${fmtQty(r.adjusted_daily_demand)}</div><div><b>${fmtQty(r.recommended_qty)}</b><div class="dc-smart-help">${fmtMoney(r.estimated_purchase_cost)}</div></div><div class="dc-priority ${esc(r.recommendation_priority)}">${esc(r.recommendation_priority)}</div></div>`).join('')}</div>`;
    document.getElementById('dc-smart-start').onclick=()=>createRun(rows);
  }

  async function createRun(rows){
    try{
      const result=await rpc('create_purchase_recommendation_run');
      currentRun=result;
      const c=getClient();
      const {data,error}=await c.from('purchase_recommendation_items').select('id,run_id,product_id,recommended_qty,selected_qty,unit_cost,estimated_selected_cost,reason,manual_override,override_reason,products(name,sku)').eq('run_id',result.run_id).order('estimated_selected_cost',{ascending:false});
      if(error) throw error;
      renderEditable(data||[],result);
    }catch(e){console.error(e);toast(e.message||'Could not create the shopping list.');}
  }

  function renderEditable(items,run){
    const body=document.getElementById('dc-smart-body');
    body.innerHTML=`<div class="dc-smart-actions"><button class="primary" id="dc-smart-confirm">Confirm shopping list</button><button class="secondary" id="dc-smart-cancel">Cancel</button><span class="dc-smart-help">Run ${esc(run.run_number)} · system recommendation is preserved.</span></div><div class="dc-smart-table"><div class="dc-smart-row head"><div>Product</div><div>Recommended</div><div>Buy</div><div>Est. cost</div><div>Reason if changed</div></div>${items.map((x,i)=>`<div class="dc-smart-row" data-i="${i}" data-product="${x.product_id}" data-recommended="${x.recommended_qty}" data-cost="${x.unit_cost}"><div><b>${esc(x.products?.name||'Product')}</b><div class="dc-smart-help">${esc(x.products?.sku||'')}</div></div><div>${fmtQty(x.recommended_qty)}</div><div><input class="dc-selected" type="number" min="0" step="0.001" value="${x.selected_qty}"></div><div class="dc-selected-cost">${fmtMoney(x.estimated_selected_cost)}</div><div><input class="dc-reason" placeholder="Required if changed"></div></div>`).join('')}</div><div class="dc-smart-total">Estimated selected cost: <span id="dc-smart-total" style="margin-left:.4rem">UGX 0</span></div>`;
    const recalc=()=>{let total=0;qsa('.dc-smart-row[data-product]').forEach(r=>{const q=Number(r.querySelector('.dc-selected').value||0),c=Number(r.dataset.cost||0);total+=q*c;r.querySelector('.dc-selected-cost').textContent=fmtMoney(q*c);});document.getElementById('dc-smart-total').textContent=fmtMoney(total);};
    const qsa=s=>Array.from(body.querySelectorAll(s)); qsa('.dc-selected').forEach(i=>i.addEventListener('input',recalc)); recalc();
    document.getElementById('dc-smart-confirm').onclick=()=>confirmRun(run,items);
    document.getElementById('dc-smart-cancel').onclick=()=>loadRecommendations();
  }

  async function confirmRun(run,items){
    const body=document.getElementById('dc-smart-body'); const payload=[];
    for(const row of Array.from(body.querySelectorAll('.dc-smart-row[data-product]'))){
      const product_id=row.dataset.product, selected_qty=Number(row.querySelector('.dc-selected').value||0), recommended_qty=Number(row.dataset.recommended||0), override_reason=row.querySelector('.dc-reason').value.trim();
      if(selected_qty!==recommended_qty && !override_reason){toast('Give a reason for every changed quantity.');return;}
      payload.push({product_id,selected_qty,override_reason});
    }
    try{
      const result=await rpc('confirm_purchase_recommendation',{p_run_id:run.run_id,p_items:payload,p_notes:'Shopping list confirmed from Buy & receive'});
      toast('Shopping list '+run.run_number+' confirmed.');
      body.querySelector('.dc-smart-actions').innerHTML='<span class="dc-smart-help"><b>Confirmed.</b> '+esc(run.run_number)+' · estimated selected cost '+fmtMoney(result.selected_cost)+'</span>';
      const email=document.createElement('button'); email.className='secondary'; email.textContent='Email management summary'; email.onclick=async()=>{try{await rpc('queue_purchase_recommendation_email',{p_run_id:run.run_id});toast('Management shopping summary queued for email.');}catch(e){toast(e.message||'Only management staff can queue the email.');}};body.querySelector('.dc-smart-actions').appendChild(email);
    }catch(e){console.error(e);toast(e.message||'Could not confirm the shopping list.');}
  }

  styles();
  const mo=new MutationObserver(()=>{if(document.getElementById('purchases-view')) mount();});
  mo.observe(document.body,{subtree:true,childList:true});
  setTimeout(()=>{mount();},500);
})();
