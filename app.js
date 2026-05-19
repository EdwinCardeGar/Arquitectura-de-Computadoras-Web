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
// app.js — enhanced: search + full ZIP export using JSZip
const DB_NAME = 'classNotesDB_v2';
const STORE = 'notes';
let searchQuery = '';
let editingId = null;
let lastAction = null; // {type:'delete'|'update', prev:object}

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

  noteForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const type = document.getElementById('noteType').value;
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    if(!title) return alert('Título requerido');
    await addNote({type, title, content, created:Date.now()});
    noteForm.reset();
    await renderAll();
  });

  slideForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const title = document.getElementById('slideTitle').value.trim();
    const fileInput = document.getElementById('slideFile');
    const file = fileInput.files[0];
    if(!title || !file) return alert('Título y archivo requeridos');
    // Store file as blob in IndexedDB
    await addNote({type:'slide', title, filename:file.name, file, created:Date.now()});
    slideForm.reset();
    await renderAll();
  });

  exportJsonBtn.addEventListener('click', async ()=>{
    const all = await getAll();
    const exportable = all.map(item=>({id:item.id,type:item.type,title:item.title,filename:item.filename||null,content:item.content||null,created:item.created}));
    const blob = new Blob([JSON.stringify(exportable, null, 2)],{type:'application/json'});
    downloadBlob(blob,'apuntes_export.json');
  });

  exportZipBtn.addEventListener('click', async ()=>{
    if(typeof JSZip === 'undefined') return alert('JSZip no cargado. Asegúrate de tener conexión a internet o incluir la librería.');
    const all = await getAll();
    const zip = new JSZip();
    zip.file('metadata.json', JSON.stringify({generated:Date.now(),count:all.length}, null, 2));
    const notesFolder = zip.folder('notes');
    const slidesFolder = zip.folder('slides');
    for(const it of all){
      const base = {id:it.id,type:it.type,title:it.title,filename:it.filename||null,created:it.created,content:it.content||null};
      if(it.type==='slide' && it.file){
        // add metadata and binary
        notesFolder.file(`note_${it.id}.json`, JSON.stringify(base, null, 2));
        try{ slidesFolder.file(it.filename || `slide_${it.id}`, it.file); }catch(e){
          // fallback: if blob can't be added directly, try ArrayBuffer
          const arr = await blobToArrayBuffer(it.file);
          slidesFolder.file(it.filename || `slide_${it.id}`, arr);
        }
      } else {
        notesFolder.file(`note_${it.id}.json`, JSON.stringify(base, null, 2));
      }
    }
    const content = await zip.generateAsync({type:'blob'});

        // Undo button
        const undoBtn = document.getElementById('undoBtn');
        function setUndoState(){
          undoBtn.disabled = !lastAction;
        }
        undoBtn.addEventListener('click', async ()=>{
          if(!lastAction) return;
          if(lastAction.type === 'delete'){
            // restore previous object with same id
            await putNote(lastAction.prev);
          } else if(lastAction.type === 'update'){
            await putNote(lastAction.prev);
          }
          lastAction = null;
          setUndoState();
          renderAll();
        });

    downloadBlob(content, 'apuntes_completo.zip');
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
    // capture previous for undo
    const prev = await getById(editingId);
    const updates = {title, content};
    // if there's a file selected, replace
    if(editFile && editFile.files && editFile.files[0]){
      updates.file = editFile.files[0];
      updates.filename = editFile.files[0].name;
    }
    await updateNote(editingId, updates);
    lastAction = {type:'update', prev};
    setUndoState();
    closeEditModal();
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

  searchInput.addEventListener('input', e=>{
    searchQuery = e.target.value.trim().toLowerCase();
    renderAll();
  });

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
        // save previous for undo
        const prev = await getById(it.id);
        await deleteById(it.id);
        lastAction = {type:'delete', prev};
        setUndoState();
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
        lastAction = {type:'delete', prev};
        setUndoState();
        renderAll();
      };
      right.appendChild(dl); right.appendChild(edit); right.appendChild(del);
      li.appendChild(left); li.appendChild(right); ul.appendChild(li);
    })
  }

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

  renderAll();
});
