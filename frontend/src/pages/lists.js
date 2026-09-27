import { apiDelete, apiGet, apiPost } from '../lib/http.js';
import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, emptyHTML, errorHTML, loadingHTML, showToast, wireRetry } from '../lib/ui.js';
import { shareButtonHTML, wireShare } from '../lib/share.js';

// Custom lists (backend/src/routes/lists.js): named, ordered, shareable lists
// like "Comfort shows". #/lists is your own, #/list/:id is one list; the
// detail page's "Add to list" and the profile's lists section live here too.

export function listCardHTML(l) {
  const covers = l.covers.slice(0, 4);
  return `
    <a class="list-card" href="#/list/${l.id}">
      <div class="list-card-covers">${covers.length
    ? covers.map((c) => `<img src="${escapeHtml(c)}" alt="" loading="lazy" />`).join('')
    : '<span aria-hidden="true">📋</span>'}</div>
      <strong>${escapeHtml(l.name)}</strong>
      <span class="section-sub">${l.count} anime</span>
    </a>`;
}

const listGridHTML = (lists) => `<div class="list-grid">${lists.map(listCardHTML).join('')}</div>`;

export async function renderMyLists(root) {
  document.title = 'My Lists — AniNest';
  if (!Auth.get().user) { navigate('#/login'); return; }
  root.innerHTML = loadingHTML('FETCHING YOUR LISTS');
  let lists;
  try {
    ({ lists } = await apiGet('/api/lists/mine'));
  } catch {
    root.innerHTML = errorHTML('Couldn’t load your lists.');
    wireRetry(root, () => renderMyLists(root));
    return;
  }
  root.innerHTML = `
    <div class="section-head">
      <h1 class="section-title">📋 My Lists</h1>
      <span class="section-sub">Your own collections, like "Comfort shows" or "Best of 2026". Each one has a link you can share.</span>
    </div>
    <form id="new-list" class="hero-actions" style="margin:6px 0 18px">
      <input name="name" maxlength="60" required placeholder="New list name" aria-label="New list name" class="list-input" />
      <button class="btn-pow btn-pow--pink" type="submit">➕ CREATE</button>
    </form>
    ${lists.length ? listGridHTML(lists) : emptyHTML('No lists yet. Make one above, then add anime from any anime page.', '📋')}`;
  root.querySelector('#new-list').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { data } = await apiPost('/api/lists', { name: e.target.name.value });
      navigate(`#/list/${data.id}`);
    } catch (err) {
      showToast(err.message || 'Couldn’t create the list.');
    }
  });
}

function itemHTML(item, i, list) {
  return `
    <li class="list-item">
      <span class="list-rank">${i + 1}</span>
      ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" />` : '<div class="duel-cover"></div>'}
      <div class="duel-body">
        <a class="duel-song" href="#/anime/${item.mal_id}">${escapeHtml(item.title)}</a>
        ${list.mine
    ? `<input class="list-input list-note" data-note="${item.mal_id}" maxlength="200" placeholder="Add a note" value="${escapeHtml(item.note || '')}" aria-label="Note for ${escapeHtml(item.title)}" />`
    : (item.note ? `<p class="list-note-text">${escapeHtml(item.note)}</p>` : '')}
      </div>
      ${list.mine ? `
      <div class="list-item-tools">
        <button class="chip" data-move="-1" data-id="${item.mal_id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
        <button class="chip" data-move="1" data-id="${item.mal_id}" ${i === list.items.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
        <button class="chip" data-remove="${item.mal_id}" aria-label="Remove">✕</button>
      </div>` : ''}
    </li>`;
}

function listPageHTML(list) {
  return `
    <div class="section-head">
      <h1 class="section-title">📋 ${escapeHtml(list.name)}</h1>
      <span class="section-sub">A list by <a href="#/u/${encodeURIComponent(list.owner)}">${escapeHtml(list.owner)}</a> · ${list.items.length} anime</span>
    </div>
    ${list.description ? `<p class="speech-bubble">${escapeHtml(list.description)}</p>` : ''}
    <div class="hero-actions" style="margin-bottom:14px">
      ${shareButtonHTML()}
      ${list.mine ? '<button class="btn-pow btn-pow--outline" id="list-edit">✏️ EDIT</button><button class="btn-pow btn-pow--outline" id="list-delete">🗑️ DELETE</button>' : ''}
    </div>
    ${list.mine ? `
    <form id="list-edit-form" class="list-edit" hidden>
      <input name="name" maxlength="60" required class="list-input" value="${escapeHtml(list.name)}" aria-label="List name" />
      <textarea name="description" maxlength="300" class="list-input" rows="2" placeholder="What’s this list about? (optional)" aria-label="Description">${escapeHtml(list.description || '')}</textarea>
      <button class="btn-pow btn-pow--pink" type="submit">SAVE</button>
    </form>` : ''}
    ${list.items.length
    ? `<ol class="list-items">${list.items.map((item, i) => itemHTML(item, i, list)).join('')}</ol>`
    : emptyHTML(list.mine ? 'Nothing here yet. Use “Add to list” on any anime page.' : 'This list is empty.', '📋')}`;
}

function wireList(root, state) {
  const { list } = state;
  const redraw = (next) => { state.list = next; root.innerHTML = listPageHTML(next); wireList(root, state); };
  const act = async (fn) => {
    try { redraw((await fn()).data); } catch (err) { showToast(err.message || 'Couldn’t save — try again.'); }
  };
  wireShare(root, { kind: 'list', id: list.id, title: `${list.name} — AniNest` });
  if (!list.mine) return;
  root.querySelector('#list-edit').addEventListener('click', () => { root.querySelector('#list-edit-form').hidden = false; });
  root.querySelector('#list-edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    act(() => apiPost(`/api/lists/${list.id}`, { name: e.target.name.value, description: e.target.description.value || null }));
  });
  root.querySelector('#list-delete').addEventListener('click', async () => {
    if (!window.confirm(`Delete “${list.name}”? This can’t be undone.`)) return;
    try {
      await apiDelete(`/api/lists/${list.id}`);
      navigate('#/lists');
    } catch (err) {
      showToast(err.message || 'Couldn’t delete the list.');
    }
  });
  root.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => act(() => apiDelete(`/api/lists/${list.id}/items/${btn.dataset.remove}`))));
  root.querySelectorAll('[data-move]').forEach((btn) => btn.addEventListener('click', () => {
    const ids = list.items.map((i) => i.mal_id);
    const from = ids.indexOf(Number(btn.dataset.id));
    const to = from + Number(btn.dataset.move);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    act(() => apiPost(`/api/lists/${list.id}/order`, { mal_ids: ids }));
  }));
  root.querySelectorAll('[data-note]').forEach((input) => input.addEventListener('change', async () => {
    const item = list.items.find((i) => i.mal_id === Number(input.dataset.note));
    try {
      state.list = (await apiPost(`/api/lists/${list.id}/items`, { mal_id: item.mal_id, title: item.title, image: item.image || '', note: input.value || null })).data;
      showToast('Note saved.');
    } catch (err) {
      showToast(err.message || 'Couldn’t save the note.');
    }
  }));
}

export async function renderList(root, id) {
  root.innerHTML = loadingHTML('OPENING THE LIST');
  let list;
  try {
    ({ data: list } = await apiGet(`/api/lists/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err.status === 404) { root.innerHTML = emptyHTML('This list doesn’t exist, or its owner keeps it private.', '📋'); return; }
    root.innerHTML = errorHTML('Couldn’t load the list.');
    wireRetry(root, () => renderList(root, id));
    return;
  }
  document.title = `${list.name} — AniNest`;
  root.innerHTML = listPageHTML(list);
  wireList(root, { list });
}

// "Add to list" on an anime's detail page: a small panel with your lists and
// a quick "new list" field.
export function addToListButtonHTML() {
  return Auth.get().user ? '<button type="button" class="btn-pow btn-pow--outline" id="add-to-list">📋 ADD TO LIST</button><div id="add-to-list-panel" class="add-to-list-panel" hidden></div>' : '';
}

export function wireAddToList(root, anime) {
  const btn = root.querySelector('#add-to-list');
  const panel = root.querySelector('#add-to-list-panel');
  if (!btn) return;
  const item = { mal_id: anime.mal_id, title: anime.title, image: anime.image || '' };
  const addTo = async (listId, name) => {
    try {
      await apiPost(`/api/lists/${listId}/items`, item);
      panel.hidden = true;
      showToast(`Added to “${name}”.`);
    } catch (err) {
      showToast(err.message || 'Couldn’t add it — try again.');
    }
  };
  btn.addEventListener('click', async () => {
    if (!panel.hidden) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = loadingHTML('');
    let lists = [];
    try { ({ lists } = await apiGet('/api/lists/mine')); } catch { /* the new-list form still works */ }
    panel.innerHTML = `
      ${lists.map((l) => `<button type="button" class="chip" data-list="${l.id}">${escapeHtml(l.name)}</button>`).join('')}
      <form class="add-to-list-new">
        <input name="name" maxlength="60" required placeholder="New list…" aria-label="New list name" class="list-input" />
        <button class="chip" type="submit">➕</button>
      </form>`;
    panel.querySelectorAll('[data-list]').forEach((b) => b.addEventListener('click', () => addTo(b.dataset.list, b.textContent)));
    panel.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const { data } = await apiPost('/api/lists', { name: e.target.name.value });
        await addTo(data.id, data.name);
      } catch (err) {
        showToast(err.message || 'Couldn’t create the list.');
      }
    });
  });
}

// A profile's lists section; stays empty when they have none (or are private).
export async function loadProfileLists(root, username) {
  const slot = root.querySelector('#profile-lists');
  if (!slot) return;
  let lists = [];
  try { ({ lists = [] } = await apiGet(`/api/lists/user/${encodeURIComponent(username)}`)); } catch { return; }
  if (!lists.length || !slot.isConnected) return;
  slot.innerHTML = `
    <section class="section">
      <div class="section-head"><h2 class="section-title">📋 Lists</h2></div>
      ${listGridHTML(lists)}
    </section>`;
}
