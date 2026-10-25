(function(){
  'use strict';

  const cfg = window.DREAM_CITY_SUPABASE_CONFIG || {};
  let client = null;
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));

  function loadUxRefresh(){
    if(document.getElementById('dream-city-ux-refresh-script')) return;
    const s=document.createElement('script');
    s.id='dream-city-ux-refresh-script';
    s.src='ux-refresh.js';
    s.defer=true;
    document.head.appendChild(s);
  }

  function getClient(){
    if(client) return client;
    if(!cfg.url || !cfg.anonKey || !window.supabase) return null;
    client = window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return client;
  }

  function styles(){
    if(document.getElementById('dc-product-intel-style')) return;
    const s=document.createElement('style');
    s.id='dc-product-intel-style';
    s.textContent=`
      .dc-pintel{margin:0 0 1rem;background:#fff;border:1px solid #dfe5e1;border-radius:16px;padding:1rem;box-shadow:0 4px 18px rgba(16,24,40,.05)}
      .dc-pintel h3{margin:.1rem 0 .25rem}.dc-pintel-help{color:#667085;font-size:.88rem}
      .dc-pintel-search{display:flex;gap:.5rem;margin-top:.75rem}.dc-pintel-search input{flex:1;min-height:42px;border:1px solid #d0d5dd;border-radius:9px;padding:.6rem .75rem}
      .dc-pintel-results{margin-top:.7rem;border:1px solid #eaecf0;border-radius:10px;overflow:hidden}.dc-pintel-item{display:flex;justify-content:space-between;gap:1rem;padding:.65rem .75rem;border-bottom:1px solid #eaecf0;cursor:pointer}.dc-pintel-item:last-child{border-bottom:0}.dc-pintel-item:hover{background:#f8faf9}.dc-pintel-meta{font-size:.78rem;color:#667085}.dc-pintel-price{white-space:nowrap;font-weight:700}.dc-pintel-empty{padding:.8rem;color:#667085}
      @media(max-width:650px){.dc-pintel-search{display:block}.dc-pintel-search button{margin-top:.45rem}.dc-pintel-item{display:block}.dc-pintel-price{margin-top:.25rem}}
    `;
    document.head.appendChild(s);
  }

  async function search(term){
    const c=getClient();
    if(!c) throw new Error('Supabase client is not ready');
    const {data,error}=await c.rpc('search_dream_city_products',{p_query:term||'',p_limit:12});
    if(error) throw error;
    return data||[];
  }

  function mount(){
    const v=document.getElementById('purchases-view');
    if(!v || document.getElementById('dc-product-intelligence')) return;
    const box=document.createElement('section');
    box.id='dc-product-intelligence';
    box.className='dc-pintel';
    box.innerHTML=`<p class="eyebrow">PRODUCT INTELLIGENCE</p><h3>Find a product</h3><div class="dc-pintel-help">Search the 341-product Dream City catalogue by name, SKU or category. This is a reference dictionary — it does not change live stock.</div><div class="dc-pintel-search"><input id="dc-pintel-input" autocomplete="off" placeholder="Type e.g. sugar, pads, comb…"><button class="primary" id="dc-pintel-btn">Search</button></div><div id="dc-pintel-results"></div>`;
    const anchor=document.getElementById('dc-smart-purchasing');
    if(anchor) anchor.parentNode.insertBefore(box,anchor.nextSibling); else v.prepend(box);
    const input=box.querySelector('#dc-pintel-input');
    const btn=box.querySelector('#dc-pintel-btn');
    const results=box.querySelector('#dc-pintel-results');
    let timer;
    const run=async()=>{
      const term=input.value.trim();
      results.innerHTML='<div class="dc-pintel-empty">Searching…</div>';
      try{
        const rows=await search(term);
        if(!rows.length){results.innerHTML='<div class="dc-pintel-empty">No catalogue match found.</div>';return;}
        results.innerHTML='<div class="dc-pintel-results">'+rows.map(r=>`<div class="dc-pintel-item"><div><b>${esc(r.product_name)}</b><div class="dc-pintel-meta">${esc(r.category||'Uncategorised')} · SKU ${esc(r.source_sku||r.source_handle||'—')}</div></div><div class="dc-pintel-price">UGX ${Number(r.source_price||0).toLocaleString('en-UG')}</div></div>`).join('')+'</div>';
      }catch(e){console.error(e);results.innerHTML='<div class="dc-pintel-empty">Catalogue intelligence is ready in the database; run the product-intelligence migration to activate search.</div>';}
    };
    btn.onclick=run;
    input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,220);});
    run();
  }

  loadUxRefresh();
  styles();
  const mo=new MutationObserver(mount);
  mo.observe(document.body,{subtree:true,childList:true});
  setTimeout(mount,700);
})();
