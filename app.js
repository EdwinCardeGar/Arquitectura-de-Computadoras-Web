// app.js — search + full ZIP export using JSZip, toasts and multi-step undo
const DB_NAME = 'classNotesDB_v2';
const STORE = 'notes';
let searchQuery = '';
let editingId = null;
const actionStack = []; // stack of previous actions for undo
const MAX_HISTORY = 20;

function openDB(){
  return new Promise((res, rej)=>{
    const req = indexedDB.open(DB_NAME,1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});
      }
    }
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  })
}

async function addNote(obj){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    const store = tx.objectStore(STORE);
    store.add(obj);
    tx.oncomplete = ()=>res();
    tx.onerror = ()=>rej(tx.error);
  })
}

async function getAll(){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = ()=>res(req.result);
    req.onerror = ()=>rej(req.error);
  })
}

async function deleteById(id){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = ()=>res();
    tx.onerror = ()=>rej(tx.error);
  })
}

async function getById(id){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = ()=>res(req.result);
    req.onerror = ()=>rej(req.error);
  })
}

async function putNote(obj){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(obj);
    tx.oncomplete = ()=>res();
    tx.onerror = ()=>rej(tx.error);
  })
}

async function updateNote(id, updates){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = ()=>{
      const obj = req.result;
      if(!obj) { res(); return; }
      Object.assign(obj, updates);
      store.put(obj);
    };
    tx.oncomplete = ()=>res();
    tx.onerror = ()=>rej(tx.error);
  })
}

document.addEventListener('DOMContentLoaded',()=>{
  const noteForm = document.getElementById('noteForm');
  const slideForm = document.getElementById('slideForm');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportZipBtn = document.getElementById('exportZipBtn');
  const searchInput = document.getElementById('searchInput');
  const undoBtn = document.getElementById('undoBtn');

  function setUndoState(){ undoBtn.disabled = actionStack.length === 0; }

  function pushAction(action){
    actionStack.push(action);
    if(actionStack.length > MAX_HISTORY) actionStack.shift();
    setUndoState();
    renderHistory();
  }

  function showToast(msg, type='info', timeout=3500, actionLabel, actionCallback){
    const container = document.getElementById('toastContainer');
    if(!container) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const span = document.createElement('span'); span.textContent = msg;
    const closeBtn = document.createElement('button'); closeBtn.className = 'close'; closeBtn.setAttribute('aria-label','Cerrar'); closeBtn.textContent = '×';
    t.appendChild(span);
    if(actionLabel && typeof actionCallback === 'function'){
      const act = document.createElement('button'); act.className = 'action'; act.textContent = actionLabel;
      act.onclick = ()=>{
        try{ actionCallback(); }catch(e){ console.error(e); }
        t.remove();
      };
      t.appendChild(act);
    }
    t.appendChild(closeBtn);
    container.appendChild(t);
    closeBtn.onclick = ()=>{ t.remove(); };
    setTimeout(()=>{ try{ t.remove(); }catch(e){} }, timeout);
  }

  noteForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const type = document.getElementById('noteType').value;
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    if(!title) return alert('Título requerido');
    await addNote({type, title, content, created:Date.now()});
    noteForm.reset();
    await renderAll();
    showToast('Nota guardada','success');
  });

  slideForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const title = document.getElementById('slideTitle').value.trim();
    const fileInput = document.getElementById('slideFile');
    const file = fileInput.files[0];
    if(!title || !file) return alert('Título y archivo requeridos');
    await addNote({type:'slide', title, filename:file.name, file, created:Date.now()});
    slideForm.reset();
    await renderAll();
    showToast('Diapositiva subida','success');
  });

  exportJsonBtn.addEventListener('click', async ()=>{
    const all = await getAll();
    const exportable = all.map(item=>({id:item.id,type:item.type,title:item.title,filename:item.filename||null,content:item.content||null,created:item.created}));
    const blob = new Blob([JSON.stringify(exportable, null, 2)],{type:'application/json'});
    downloadBlob(blob,'apuntes_export.json');
    showToast('Exportado JSON correctamente','success');
  });

  exportZipBtn.addEventListener('click', async ()=>{
    if(typeof JSZip === 'undefined') return showToast('JSZip no cargado','warn');
    const all = await getAll();
    const zip = new JSZip();
    zip.file('metadata.json', JSON.stringify({generated:Date.now(),count:all.length}, null, 2));
    const notesFolder = zip.folder('notes');
    const slidesFolder = zip.folder('slides');
    for(const it of all){
      const base = {id:it.id,type:it.type,title:it.title,filename:it.filename||null,created:it.created,content:it.content||null};
      notesFolder.file(`note_${it.id}.json`, JSON.stringify(base, null, 2));
      if(it.type==='slide' && it.file){
        try{ slidesFolder.file(it.filename || `slide_${it.id}`, it.file); }catch(e){
          const arr = await blobToArrayBuffer(it.file);
          slidesFolder.file(it.filename || `slide_${it.id}`, arr);
        }
      }
    }
    const content = await zip.generateAsync({type:'blob'});
    downloadBlob(content, 'apuntes_completo.zip');
    showToast('ZIP exportado correctamente','success');
  });

  undoBtn.addEventListener('click', async ()=>{
    if(actionStack.length === 0) return;
    const last = actionStack.pop();
    if(last.type === 'delete' || last.type === 'update'){
      await putNote(last.prev);
      showToast('Acción deshecha','info');
    }
    setUndoState();
    renderHistory();
    renderAll();
  });
    // Navegación: smooth scroll y resaltado de enlace activo
    document.addEventListener('DOMContentLoaded', ()=>{
      const navLinks = document.querySelectorAll('.nav-links a');
      if(navLinks.length === 0) return;

      navLinks.forEach(a => {
        a.addEventListener('click', (e) => {
          const href = a.getAttribute('href');
          if(href && href.startsWith('#')){
            e.preventDefault();
            const id = href.slice(1);
            // If this anchor corresponds to a tab, activate the tab instead of plain scroll
            if(window.showPanel && document.querySelector(`.tab[data-target="${id}"]`)){
              window.showPanel(id);
              return;
            }
            const target = document.querySelector(href);
            if(target){
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              navLinks.forEach(l=>l.classList.remove('active'));
              a.classList.add('active');
              try{ history.replaceState(null, '', href); }catch(e){}
            }
          }
        });
      });

      // Resaltar el enlace correspondiente según la sección visible
      const sections = document.querySelectorAll('section[id]');
      const io = new IntersectionObserver((entries)=>{
        entries.forEach(entry => {
          const id = entry.target.id;
          const link = document.querySelector(`.nav-links a[href="#${id}"]`);
          if(entry.isIntersecting){
            navLinks.forEach(l=>l.classList.remove('active'));
            if(link) link.classList.add('active');
          }
        });
      }, { threshold: 0.45 });
      sections.forEach(s=>io.observe(s));
    });

  searchInput.addEventListener('input', e=>{
    searchQuery = e.target.value.trim().toLowerCase();
    renderAll();
  });

  // Edit modal handlers
  const editModal = document.getElementById('editModal');
  const editForm = document.getElementById('editForm');
  const editTitle = document.getElementById('editTitle');
  const editContent = document.getElementById('editContent');
  const editFile = document.getElementById('editFile');
  const cancelEdit = document.getElementById('cancelEdit');
  const contentLabel = document.getElementById('contentLabel');
  const fileLabel = document.getElementById('fileLabel');

  cancelEdit.addEventListener('click', ()=>{ closeEditModal(); });

  editForm.addEventListener('submit', async e=>{
    e.preventDefault();
    if(!editingId) return closeEditModal();
    const title = editTitle.value.trim();
    const content = editContent.value.trim();
    if(!title) return alert('Título requerido');
    const prev = await getById(editingId);
    const updates = {title, content};
    if(editFile && editFile.files && editFile.files[0]){
      updates.file = editFile.files[0];
      updates.filename = editFile.files[0].name;
    }
    await updateNote(editingId, updates);
    pushAction({type:'update', prev});
    closeEditModal();
    showToast('Cambios guardados','success',5000,'Deshacer', async ()=>{
      // undo this specific update
      await putNote(prev);
      const idx = actionStack.findIndex(a=>a.prev && a.prev.id === prev.id && a.type === 'update');
      if(idx !== -1) actionStack.splice(idx,1);
      setUndoState();
      renderAll();
      showToast('Acción deshecha','info');
    });
    renderAll();
  });

  function openEditModal(item){
    editingId = item.id;
    editTitle.value = item.title || '';
    editContent.value = item.content || '';
    if(item.type === 'slide'){
      contentLabel.style.display = 'none';
      fileLabel.style.display = 'block';
      editFile.value = '';
      document.getElementById('modalTitle').textContent = 'Editar diapositiva';
    } else {
      contentLabel.style.display = 'block';
      fileLabel.style.display = 'none';
      document.getElementById('modalTitle').textContent = 'Editar nota';
    }
    editModal.removeAttribute('hidden');
  }

  function closeEditModal(){
    editingId = null;
    editModal.setAttribute('hidden', '');
  }

  window.renderAll = async function(){
    const all = await getAll();
    const filtered = all.filter(i=>{
      if(!searchQuery) return true;
      const hay = (i.title||'') + ' ' + (i.content||'') + ' ' + (i.filename||'');
      return hay.toLowerCase().includes(searchQuery);
    });
    const reports = filtered.filter(i=>i.type==='reporte');
    const concepts = filtered.filter(i=>i.type==='concepto');
    const temario = filtered.filter(i=>i.type==='temario');
    const slides = filtered.filter(i=>i.type==='slide');
    fillList('reportsList', reports);
    fillList('conceptsList', concepts);
    fillList('temarioList', temario);
    fillSlides('slidesList', slides);
  }

  function fillList(id, items){
    const ul = document.getElementById(id); ul.innerHTML='';
    items.sort((a,b)=>b.created-a.created).forEach(it=>{
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.innerHTML = `<strong>${escapeHtml(it.title)}</strong><div class="meta">${new Date(it.created).toLocaleString()}</div>`;
      const right = document.createElement('div');
      const view = document.createElement('button'); view.textContent='Ver'; view.onclick = ()=>showContent(it);
      const edit = document.createElement('button'); edit.textContent='Editar'; edit.onclick = ()=>openEditModal(it);
      const del = document.createElement('button'); del.textContent='Borrar'; del.onclick = async ()=>{
        if(!confirm('Borrar?')) return;
        const prev = await getById(it.id);
        await deleteById(it.id);
        const action = {type:'delete', prev};
        pushAction(action);
        showToast('Entrada borrada','warn',5000,'Deshacer', async ()=>{
          // undo this specific action
          await putNote(action.prev);
          // remove from stack if still present
          const idx = actionStack.findIndex(a=>a.prev && a.prev.id === action.prev.id && a.type === action.type);
          if(idx !== -1) actionStack.splice(idx,1);
          setUndoState();
          renderAll();
          showToast('Acción deshecha','info');
        });
        renderHistory();
        renderAll();
      };
      right.appendChild(view); right.appendChild(edit); right.appendChild(del);
      li.appendChild(left); li.appendChild(right); ul.appendChild(li);
    })
  }

  function fillSlides(id, items){
    const ul = document.getElementById(id); ul.innerHTML='';
    items.sort((a,b)=>b.created-a.created).forEach(it=>{
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.innerHTML = `<strong>${escapeHtml(it.title)}</strong><div class="meta">${it.filename} · ${new Date(it.created).toLocaleString()}</div>`;
      const right = document.createElement('div');
      const dl = document.createElement('button'); dl.textContent='Descargar'; dl.onclick = ()=>downloadSlide(it.id, it.filename);
      const edit = document.createElement('button'); edit.textContent='Editar'; edit.onclick = ()=>openEditModal(it);
      const del = document.createElement('button'); del.textContent='Borrar'; del.onclick = async ()=>{
        if(!confirm('Borrar?')) return;
        const prev = await getById(it.id);
        await deleteById(it.id);
        const action = {type:'delete', prev};
        pushAction(action);
        showToast('Entrada borrada','warn',5000,'Deshacer', async ()=>{
          await putNote(action.prev);
          const idx = actionStack.findIndex(a=>a.prev && a.prev.id === action.prev.id && a.type === action.type);
          if(idx !== -1) actionStack.splice(idx,1);
          setUndoState();
          renderAll();
          showToast('Acción deshecha','info');
        });
        renderHistory();
        renderAll();
      };
      right.appendChild(dl); right.appendChild(edit); right.appendChild(del);
      li.appendChild(left); li.appendChild(right); ul.appendChild(li);
    })
  }

  // History rendering and controls
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const exportHistoryBtn = document.getElementById('exportHistoryBtn');

  function renderHistory(){
    if(!historyList) return;
    historyList.innerHTML = '';
    // show most recent first
    const copy = actionStack.slice().reverse();
    copy.forEach((act, idx)=>{
      const li = document.createElement('li');
      const left = document.createElement('div'); left.className = 'history-left';
      const title = document.createElement('div'); title.className = 'history-title';
      title.textContent = `${act.type === 'delete' ? 'Borrado' : 'Edición'} — ${act.prev?.title || ''}`;
      const meta = document.createElement('div'); meta.className = 'history-meta';
      meta.textContent = `${act.prev?.type || ''} · ${new Date(act.prev?.created || Date.now()).toLocaleString()}`;
      left.appendChild(title); left.appendChild(meta);
      const actions = document.createElement('div'); actions.className = 'history-actions';
      const undoBtnLocal = document.createElement('button'); undoBtnLocal.className = 'undo'; undoBtnLocal.textContent = 'Deshacer';
      undoBtnLocal.onclick = async ()=>{
        // restore this action
        await putNote(act.prev);
        // remove one matching action (the earliest from top)
        const idxReal = actionStack.findIndex(a=>a.prev && a.prev.id === act.prev.id && a.type === act.type);
        if(idxReal !== -1) actionStack.splice(idxReal,1);
        setUndoState();
        renderHistory();
        renderAll();
        showToast('Acción deshecha','info');
      };
      const removeBtn = document.createElement('button'); removeBtn.className = 'remove'; removeBtn.textContent = 'Eliminar';
      removeBtn.onclick = ()=>{
        const idxReal = actionStack.findIndex(a=>a.prev && a.prev.id === act.prev.id && a.type === act.type);
        if(idxReal !== -1) actionStack.splice(idxReal,1);
        setUndoState();
        renderHistory();
        showToast('Entrada quitada del historial','info');
      };
      actions.appendChild(undoBtnLocal); actions.appendChild(removeBtn);
      li.appendChild(left); li.appendChild(actions);
      historyList.appendChild(li);
    });
  }

  clearHistoryBtn.addEventListener('click', ()=>{
    if(!confirm('Limpiar todo el historial?')) return;
    actionStack.length = 0;
    setUndoState();
    renderHistory();
    showToast('Historial limpio','info');
  });

  exportHistoryBtn.addEventListener('click', async ()=>{
    if(actionStack.length === 0) return showToast('No hay acciones en el historial','warn');
    // export a serializable version of the history
    const exportable = actionStack.map(a=>({type:a.type, title: a.prev?.title||null, id: a.prev?.id||null, filename: a.prev?.filename||null, created: a.prev?.created||null}));
    const blob = new Blob([JSON.stringify(exportable, null, 2)], {type:'application/json'});
    downloadBlob(blob, 'historial_acciones.json');
    showToast('Historial exportado (JSON)','success');
  });

  async function downloadSlide(id, filename){
    const all = await getAll();
    const it = all.find(x=>x.id===id);
    if(!it || !it.file) return alert('Archivo no encontrado');
    const url = URL.createObjectURL(it.file);
    const a = document.createElement('a'); a.href = url; a.download = filename || 'file'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function showContent(item){
    if(item.type==='slide'){
      alert(`${item.title}\nArchivo: ${item.filename}`);
    } else {
      const w = window.open('', '_blank');
      w.document.title = item.title;
      w.document.body.innerHTML = `<h2>${escapeHtml(item.title)}</h2><pre style="white-space:pre-wrap">${escapeHtml(item.content||'')}</pre>`;
    }
  }

  function escapeHtml(s){ if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function blobToArrayBuffer(b){ return new Response(b).arrayBuffer(); }

  setUndoState();
  renderAll();
});

// Pestañas: alternar paneles de recursos
document.addEventListener('DOMContentLoaded', ()=>{
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  if(!tabs || tabs.length === 0) return;

  window.showPanel = function showPanel(name, pushState = true){
    tabs.forEach(t=>{
      const active = t.getAttribute('data-target') === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach(p=>{
      const is = p.getAttribute('data-panel') === name;
      if(is){ p.removeAttribute('hidden'); p.classList.add('active'); }
      else { p.setAttribute('hidden',''); p.classList.remove('active'); }
    });
    // update top navbar active link if present
    const navLinks = document.querySelectorAll('.nav-links a');
    navLinks.forEach(l=>{
      const href = l.getAttribute('href') || '';
      const matches = href.replace('#','') === name;
      l.classList.toggle('active', matches);
    });
    if(pushState){ try{ history.replaceState(null,'',`#${name}`); }catch(e){} }
    const activePanel = document.querySelector(`.tab-panel[data-panel="${name}"]`);
    if(activePanel) activePanel.scrollIntoView({behavior:'smooth', block:'start'});
  }

  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{ const target = btn.getAttribute('data-target'); showPanel(target); });
  });

  // Initialize from hash if present
  const hash = (location.hash || '').replace('#','');
  if(hash && Array.from(tabs).some(t=>t.getAttribute('data-target')===hash)){
    showPanel(hash, false);
  }
});


document.addEventListener('DOMContentLoaded', ()=>{
  const bgCanvas = document.createElement('canvas');
  bgCanvas.id = 'interactive-bg';
  document.body.prepend(bgCanvas);

  const bgCtx = bgCanvas.getContext('2d');
  const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const ripples = [];
  const dots = [];
  const settings = {
    backgroundColor: '#071925',
    dotColor: '#3ba5e0',
    gridSpacing: 30,
    animationSpeed: 0.005,
    removeWaveLine: true,
  };
  let dpr = window.devicePixelRatio || 1;

  const getMouseInfluence = (x, y) => {
    const dx = x - mouse.x;
    const dy = y - mouse.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = 150;
    return Math.max(0, 1 - distance / maxDistance);
  };

  const getRippleInfluence = (x, y, currentTime) => {
    let totalInfluence = 0;
    ripples.forEach((ripple) => {
      const age = currentTime - ripple.time;
      const maxAge = 3000;
      if (age < maxAge) {
        const dx = x - ripple.x;
        const dy = y - ripple.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const rippleRadius = (age / maxAge) * 300;
        const rippleWidth = 60;
        if (Math.abs(distance - rippleRadius) < rippleWidth) {
          const rippleStrength = (1 - age / maxAge) * ripple.intensity;
          const proximityToRipple = 1 - Math.abs(distance - rippleRadius) / rippleWidth;
          totalInfluence += rippleStrength * proximityToRipple;
        }
      }
    });
    return Math.min(totalInfluence, 2);
  };

  const initializeDots = () => {
    const canvasWidth = bgCanvas.clientWidth;
    const canvasHeight = bgCanvas.clientHeight;
    dots.length = 0;
    for (let x = settings.gridSpacing / 2; x < canvasWidth; x += settings.gridSpacing) {
      for (let y = settings.gridSpacing / 2; y < canvasHeight; y += settings.gridSpacing) {
        dots.push({
          x,
          y,
          originalX: x,
          originalY: y,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  };

  const resizeBgCanvas = () => {
    dpr = window.devicePixelRatio || 1;
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;
    bgCanvas.width = displayWidth * dpr;
    bgCanvas.height = displayHeight * dpr;
    bgCanvas.style.width = `${displayWidth}px`;
    bgCanvas.style.height = `${displayHeight}px`;
    if (bgCtx) {
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    initializeDots();
  };

  const addRipple = (x, y) => {
    ripples.push({ x, y, time: Date.now(), intensity: 2 });
  };

  const animateBg = (() => {
    let time = 0;
    return function animate() {
      if (!bgCtx) return;
      time += settings.animationSpeed;
      const currentTime = Date.now();
      const canvasWidth = bgCanvas.clientWidth;
      const canvasHeight = bgCanvas.clientHeight;
      bgCtx.fillStyle = settings.backgroundColor;
      bgCtx.fillRect(0, 0, canvasWidth, canvasHeight);
      dots.forEach((dot) => {
        const mouseInfluence = getMouseInfluence(dot.originalX, dot.originalY);
        const rippleInfluence = getRippleInfluence(dot.originalX, dot.originalY, currentTime);
        const totalInfluence = mouseInfluence + rippleInfluence;
        const baseDotSize = 2;
        const dotSize = baseDotSize + totalInfluence * 6 + Math.sin(time + dot.phase) * 0.5;
        const opacity = Math.max(0.3, 0.6 + totalInfluence * 0.4 + Math.abs(Math.sin(time * 0.5 + dot.phase)) * 0.1);
        bgCtx.beginPath();
        bgCtx.arc(dot.originalX, dot.originalY, dotSize, 0, Math.PI * 2);
        const red = Number.parseInt(settings.dotColor.slice(1, 3), 16);
        const green = Number.parseInt(settings.dotColor.slice(3, 5), 16);
        const blue = Number.parseInt(settings.dotColor.slice(5, 7), 16);
        bgCtx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${opacity})`;
        bgCtx.fill();
      });
      if (!settings.removeWaveLine) {
        ripples.forEach((ripple) => {
          const age = currentTime - ripple.time;
          const maxAge = 3000;
          if (age < maxAge) {
            const progress = age / maxAge;
            const radius = progress * 300;
            const alpha = (1 - progress) * 0.3 * ripple.intensity;
            bgCtx.beginPath();
            bgCtx.strokeStyle = `rgba(100, 100, 100, ${alpha})`;
            bgCtx.lineWidth = 2;
            bgCtx.arc(ripple.x, ripple.y, radius, 0, 2 * Math.PI);
            bgCtx.stroke();
          }
        });
      }
      requestAnimationFrame(animate);
    };
  })();

  const handleMouseMove = (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  };

  const handleMouseDown = (e) => {
    addRipple(e.clientX, e.clientY);
    const now = Date.now();
    while (ripples.length > 0 && now - ripples[0].time > 3000) {
      ripples.shift();
    }
  };

  window.addEventListener('resize', resizeBgCanvas);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mousedown', handleMouseDown);

  resizeBgCanvas();
  animateBg();
});
