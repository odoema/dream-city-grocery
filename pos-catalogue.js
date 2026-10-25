(function(){
  'use strict';

  const cfg = window.DREAM_CITY_SUPABASE_CONFIG || {};
  let client = null;
  let legacy = [];
  let live = [];
  let departments = {};
  let activeDepartment = 'All';
  let loading = false;

  const esc = v => String(v ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
  const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const money = v => 'UGX ' + Math.round(Number(v || 0)).toLocaleString('en-UG');

  function getClient(){
    if(client) return client;
    if(!cfg.url || !cfg.anonKey || !window.supabase) return null;
    client = window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return client;
  }

  function styles(){
    if(document.getElementById('dc-pos-catalogue-style')) return;
    const s=document.createElement('style');
    s.id='dc-pos-catalogue-style';
    s.textContent=`
      #dc-pos-catalogue{margin-top:.75rem}
      .dc-pos-head{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;margin:.5rem 0 .7rem}
      .dc-pos-head h4{margin:0}.dc-pos-head p{margin:.2rem 0 0;color:#667085;font-size:.82rem}
      .dc-pos-count{font-size:.8rem;color:#667085;white-space:nowrap}
      .dc-pos-departments{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem}
      .dc-pos-dept{border:1px solid #d0d5dd;background:#fff;border-radius:999px;padding:.42rem .72rem;font-size:.78rem;cursor:pointer}
      .dc-pos-dept.active{background:#126747;color:#fff;border-color:#126747}
      .dc-pos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:.65rem}
      .dc-pos-card{border:1px solid #dfe5e1;background:#fff;border-radius:12px;padding:.72rem;text-align:left;min-height:145px;display:flex;flex-direction:column;gap:.35rem;cursor:pointer;box-shadow:0 2px 8px rgba(16,24,40,.04)}
      .dc-pos-card:hover:not(:disabled){border-color:#126747;transform:translateY(-1px)}
      .dc-pos-card:disabled{cursor:not-allowed;opacity:.72;background:#f8faf9}
      .dc-pos-name{font-weight:700;line-height:1.2}.dc-pos-meta{font-size:.72rem;color:#667085}.dc-pos-price{font-weight:800;margin-top:auto}
      .dc-pos-state{font-size:.72rem;font-weight:700}.dc-pos-state.sell{color:#087443}.dc-pos-state.low{color:#a15c00}.dc-pos-state.out{color:#b42318}.dc-pos-state.setup{color:#667085}
      .dc-pos-banner{background:#f7fbf8;border:1px solid #d7eadf;border-radius:12px;padding:.7rem .8rem;margin-bottom:.8rem;font-size:.82rem;color:#344054}
      .dc-pos-banner b{color:#126747}
      #product-grid.dc-live-engine{display:none!important}
      @media(max-width:650px){.dc-pos-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dc-pos-card{min-height:135px}}
    `;
    document.head.appendChild(s);
  }

  async function loadCatalogue(){
    if(loading) return;
    loading=true;
    try{
      const c=getClient();
      if(!c) throw new Error('Supabase client is not ready');
      const [legacyResult, liveResult, deptResult] = await Promise.all([
        c.from('dream_city_legacy_product_dictionary').select('source_handle,source_sku,source_name,source_category,display_name,source_price,lifecycle_status').order('source_name'),
        c.from('products').select('id,name,sku,barcode,quantity_on_hand,selling_price,active,reorder_level').order('name'),
        c.from('dream_city_category_dictionary').select('source_name,display_name,department,active').eq('active',true).order('sort_order')
      ]);
      if(legacyResult.error) throw legacyResult.error;
      if(liveResult.error) throw liveResult.error;
      legacy=legacyResult.data||[];
      live=liveResult.data||[];
      departments={};
      (deptResult.data||[]).forEach(row=>{ departments[norm(row.source_name)] = row.department || 'Other'; });
      if(deptResult.error) console.warn('Category dictionary unavailable:',deptResult.error.message);
    } finally {
      loading=false;
    }
  }

  function findLive(item){
    const n=norm(item.source_name||item.display_name);
    const sku=norm(item.source_sku||item.source_handle);
    return live.find(p => (sku && (norm(p.sku)===sku || norm(p.barcode)===sku)) || norm(p.name)===n) || null;
  }

  function departmentOf(item){ return departments[norm(item.source_category)] || 'Other'; }

  function render(){
    const host=document.getElementById('dc-pos-catalogue');
    if(!host || !legacy.length) return;
    const q=(document.getElementById('product-search')?.value||'').trim().toLowerCase();
    const rows=legacy.filter(item=>{
      if(activeDepartment!=='All' && departmentOf(item)!==activeDepartment) return false;
      const text=(item.source_name+' '+(item.source_sku||'')+' '+(item.source_category||'')).toLowerCase();
      return !q || text.includes(q);
    });
    const cards=rows.map(item=>{
      const p=findLive(item);
      const stock=p ? Number(p.quantity_on_hand||0) : 0;
      const active=Boolean(p?.active);
      const sellable=active && stock>0;
      const low=sellable && stock<=Number(p.reorder_level||0);
      let state='Catalogue only'; let stateClass='setup';
      if(!p){state='Add to live stock';}
      else if(!active){state='Inactive';stateClass='out';}
      else if(stock<=0){state='Out of stock';stateClass='out';}
      else if(low){state='Low stock';stateClass='low';}
      else{state='In stock';stateClass='sell';}
      const displayPrice=p?.selling_price ?? item.source_price;
      return `<button type="button" class="dc-pos-card" data-dc-live-id="${esc(p?.id||'')}" ${sellable?'':'disabled'} title="${sellable?'Add to sale':esc(state)}">
        <span class="dc-pos-name">${esc(item.display_name||item.source_name)}</span>
        <span class="dc-pos-meta">${esc(item.source_category||'Uncategorised')} · ${esc(item.source_sku||item.source_handle||'—')}</span>
        <span class="dc-pos-price">${money(displayPrice)}</span>
        <span class="dc-pos-state ${stateClass}">${esc(state)}${p&&stock>=0?' · '+stock+' left':''}</span>
      </button>`;
    }).join('');
    host.querySelector('.dc-pos-grid').innerHTML=cards||'<div class="dc-pintel-empty">No products match this search.</div>';
    host.querySelector('.dc-pos-count').textContent=rows.length+' of '+legacy.length+' catalogue items';
    host.querySelectorAll('.dc-pos-card[data-dc-live-id]').forEach(btn=>btn.addEventListener('click',()=>{
      const id=btn.dataset.dcLiveId;
      const engine=document.querySelector('#product-grid [data-product="'+CSS.escape(id)+'"]');
      if(engine && !engine.disabled) engine.click();
    }));
  }

  async function mount(){
    const view=document.getElementById('pos-view');
    const grid=document.getElementById('product-grid');
    if(!view || !grid || view.classList.contains('hidden')) return;
    styles();
    if(!document.getElementById('dc-pos-catalogue')){
      const box=document.createElement('div');
      box.id='dc-pos-catalogue';
      box.innerHTML=`<div class="dc-pos-banner"><b>341-product Dream City catalogue</b> — the old Loyverse quantities are not used. Live stock controls whether an item can be sold. Products with zero stock stay visible so staff can see the catalogue and know what needs receiving.</div><div class="dc-pos-head"><div><h4>Shop catalogue</h4><p>Search, choose a department, then tap an in-stock item to add it to the sale.</p></div><span class="dc-pos-count"></span></div><div class="dc-pos-departments"></div><div class="dc-pos-grid"><div class="muted">Loading catalogue…</div></div>`;
      grid.parentNode.insertBefore(box,grid);
      grid.classList.add('dc-live-engine');
      const search=document.getElementById('product-search');
      if(search && !search.dataset.dcBound){search.dataset.dcBound='1';search.addEventListener('input',render);}
    }
    if(!legacy.length){
      try{ await loadCatalogue(); }
      catch(e){
        console.error('Dream City POS catalogue:',e);
        const host=document.querySelector('#dc-pos-catalogue .dc-pos-grid');
        if(host) host.innerHTML='<div class="notice"><b>Catalogue preview unavailable</b><span>'+esc(e.message)+'</span></div>';
        return;
      }
    }
    const depts=['All',...Array.from(new Set(legacy.map(departmentOf))).sort()];
    const deptHost=document.querySelector('#dc-pos-catalogue .dc-pos-departments');
    deptHost.innerHTML=depts.map(d=>`<button type="button" class="dc-pos-dept ${d===activeDepartment?'active':''}" data-dc-dept="${esc(d)}">${esc(d)}</button>`).join('');
    deptHost.querySelectorAll('[data-dc-dept]').forEach(b=>b.onclick=()=>{activeDepartment=b.dataset.dcDept;render();mount();});
    render();
  }

  styles();
  const mo=new MutationObserver(()=>mount());
  mo.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  setTimeout(()=>mount(),1200);
})();
