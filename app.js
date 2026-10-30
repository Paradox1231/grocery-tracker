'use strict';

const STORAGE_KEY = 'pantry-groceries-v1'; // Legacy v1 key: intentionally retained, never erased.
const LOCATIONS_KEY = 'pantry-two-locations-v2';
const MAX_NUMBER = 1000000;
const $ = (selector) => document.querySelector(selector);
const formatQuantity = (value) => Number(value.toFixed(2)).toLocaleString('en-AU', {maximumFractionDigits:2});
const roundQuantity = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const fallbackId = () => `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function makeId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallbackId(); }
function isValidItem(x) {
  return !!x && typeof x.id === 'string' && typeof x.name === 'string' && x.name.trim().length > 0 && x.name.length <= 80 &&
    typeof x.unit === 'string' && x.unit.length <= 24 &&
    ['current','min','max'].every(k => typeof x[k] === 'number' && Number.isFinite(x[k]) && x[k] >= 0 && x[k] <= MAX_NUMBER) &&
    x.min <= x.max && x.max > 0;
}
function cleanItem(x) { return {id:x.id,name:x.name.trim(),unit:x.unit,current:x.current,min:x.min,max:x.max}; }
function validItemList(list) { return Array.isArray(list) && list.length <= 20000 && list.every(isValidItem) &&
  new Set(list.map(x => x.name.trim().toLocaleLowerCase())).size === list.length &&
  new Set(list.map(x => x.id)).size === list.length; }
function defaultLocations(items = []) {
  return {version:2,activeLocation:'one',locations:[
    {id:'one',name:'Location 1',items:items.map(cleanItem)},
    {id:'two',name:'Location 2',items:[]}
  ]};
}
function validateLocations(data) {
  return !!data && data.version === 2 && ['one','two'].includes(data.activeLocation) &&
    Array.isArray(data.locations) && data.locations.length === 2 &&
    data.locations[0].id === 'one' && data.locations[1].id === 'two' &&
    data.locations.every(loc => typeof loc.name === 'string' && !!loc.name.trim() && loc.name.length <= 40 && validItemList(loc.items));
}
function readSavedData() {
  try {
    const existing = localStorage.getItem(LOCATIONS_KEY);
    if (existing !== null) {
      const parsed = JSON.parse(existing);
      if (!validateLocations(parsed)) throw new Error('Invalid two-location data');
      return parsed;
    }
    // One-time non-destructive migration: all existing groceries go to Location 1.
    const legacyRaw = localStorage.getItem(STORAGE_KEY);
    if (legacyRaw !== null) {
      const legacy = JSON.parse(legacyRaw);
      if (!Array.isArray(legacy)) throw new Error('Invalid legacy inventory');
      return defaultLocations(legacy.filter(isValidItem));
    }
  } catch (error) { console.error('Could not load saved inventory',error); }
  return defaultLocations();
}
let pantry = readSavedData();
let activeLocation = pantry.activeLocation;
let items = pantry.locations.find(loc => loc.id === activeLocation).items;
function activeName() { return pantry.locations.find(loc => loc.id === activeLocation).name; }
let currentTab = 'inventory';
let editingId = null;
let toastTimer;
let searchTerm = '';

function save() {
  try {
    pantry.activeLocation = activeLocation;
    pantry.locations.find(loc => loc.id === activeLocation).items = items;
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(pantry));
    return true;
  } catch (error) { toast('Could not save locally. Export a backup.'); console.error(error); return false; }
}
function changeLocation(id) {
  if (!['one','two'].includes(id) || id === activeLocation) return;
  activeLocation = id;
  items = pantry.locations.find(loc => loc.id === id).items;
  editingId = null;
  searchTerm = '';
  $('#searchInput').value = '';
  save();
  render();
}
function refreshLocationControls() {
  const select = $('#locationSelect');
  select.innerHTML = pantry.locations.map(loc => `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`).join('');
  select.value = activeLocation;
  $('#inventoryHeading').textContent = `${activeName()} inventory`;
  $('#shoppingHeading').textContent = `${activeName()} shopping list`;
}
function restockQuantity(item) { return item.current < item.min ? roundQuantity(item.max - item.current) : 0; }
function lowItems() { return items.filter(x => restockQuantity(x) > 0).sort((a,b) => a.name.localeCompare(b.name)); }
function pluralUnit(item, n) { return item.unit ? ` ${item.unit}` : ''; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(value) { return escapeHtml(value); }
function iconHtml() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="15" rx="3"/><path d="M8 6V4h8v2M8 11h8M8 15h5"/></svg>'; }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800); }
function itemVisual(item, shopping = false) {
  const low = restockQuantity(item) > 0;
  const quantity = restockQuantity(item);
  const status = item.current === 0 ? 'Out of stock' : low ? 'Low stock' : 'In stock';
  const statusClass = item.current === 0 ? 'zero' : low ? 'low' : '';
  const icon = low ? '◫' : '▤';
  return `<article class="item-card" data-id="${escapeAttr(item.id)}">
    <div class="item-icon ${low ? 'low' : ''}" aria-hidden="true">${icon}</div>
    <div class="item-info">
      <div class="item-name" title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</div>
      ${shopping ? `<div class="buy-meta">Have ${formatQuantity(item.current)} · Max ${formatQuantity(item.max)}${escapeHtml(pluralUnit(item, item.max))}</div><div class="buy-count">Buy ${formatQuantity(quantity)}${escapeHtml(pluralUnit(item, quantity))}</div>` : `<div class="item-meta"><span>Min ${formatQuantity(item.min)} · Max ${formatQuantity(item.max)}${escapeHtml(pluralUnit(item,item.max))}</span><span class="stock-chip ${statusClass}">${status}</span></div>`}
    </div>
    ${shopping ? `<button type="button" class="bought-btn" data-action="bought" data-id="${escapeAttr(item.id)}" aria-label="Purchased ${escapeAttr(item.name)}, restock to maximum">Purchased ✓</button>` : `<div class="item-controls"><div class="stepper"><button type="button" class="step-btn" data-action="decrease" data-id="${escapeAttr(item.id)}" aria-label="Decrease ${escapeAttr(item.name)} stock" ${item.current <= 0 ? 'disabled' : ''}>−</button><span class="step-val" aria-label="Current stock">${formatQuantity(item.current)}</span><button type="button" class="step-btn" data-action="increase" data-id="${escapeAttr(item.id)}" aria-label="Increase ${escapeAttr(item.name)} stock">+</button></div><button type="button" class="edit-btn" data-action="edit" data-id="${escapeAttr(item.id)}" aria-label="Edit ${escapeAttr(item.name)}">⋯</button></div>`}
  </article>`;
}
function emptyVisual(type) {
  let title,desc,button = '';
  if (type === 'inventory') { title='Your pantry starts here'; desc='Add your groceries, choose a minimum and maximum, and let the shopping list take care of itself.'; button='<button type="button" class="primary-btn" data-action="new">+ Add your first item</button>'; }
  else if (type === 'search') { title='No matching items'; desc='Try another search, or add a new grocery item.'; button=''; }
  else { title='All stocked up'; desc='Items automatically appear here when their current stock drops below the minimum you set.'; }
  return `<div class="empty"><div class="empty-symbol" aria-hidden="true">${iconHtml()}</div><h3>${title}</h3><p>${desc}</p>${button}</div>`;
}
function render() {
  refreshLocationControls();
  const needed = lowItems();
  $('#totalCount').textContent = items.length;
  $('#lowCount').textContent = needed.length;
  $('#buyCount').textContent = items.length - needed.length;
  $('#shoppingPill').textContent = needed.length;
  $('#shoppingPill').hidden = needed.length === 0;
  let shown = [...items].filter(x => x.name.toLocaleLowerCase().includes(searchTerm)).sort((a,b) => {
    const aLow = restockQuantity(a) > 0 ? 0 : 1;
    const bLow = restockQuantity(b) > 0 ? 0 : 1;
    return aLow - bLow || a.name.localeCompare(b.name);
  });
  $('#inventoryList').innerHTML = shown.length ? shown.map(x => itemVisual(x)).join('') : emptyVisual(searchTerm ? 'search' : 'inventory');
  $('#shoppingList').innerHTML = needed.length ? needed.map(x => itemVisual(x,true)).join('') : emptyVisual('shopping');
  $('#inventoryPanel').hidden = currentTab !== 'inventory';
  $('#shoppingPanel').hidden = currentTab !== 'shopping';
  $('#inventoryTab').classList.toggle('active',currentTab === 'inventory');
  $('#shoppingTab').classList.toggle('active',currentTab === 'shopping');
  $('#inventoryTab').setAttribute('aria-selected',currentTab === 'inventory');
  $('#shoppingTab').setAttribute('aria-selected',currentTab === 'shopping');
}
function openItemDialog(id=null) {
  editingId = id;
  const item = items.find(x => x.id === id);
  $('#itemForm').reset();
  $('#formError').hidden = true;
  $('#itemName').value = item ? item.name : '';
  $('#itemUnit').value = item ? item.unit : '';
  $('#itemCurrent').value = item ? item.current : 0;
  $('#itemMin').value = item ? item.min : 2;
  $('#itemMax').value = item ? item.max : 6;
  $('#dialogTitle').textContent = item ? 'Edit item' : 'Add an item';
  $('#saveBtn').textContent = item ? 'Save changes' : 'Add item';
  $('#deleteBtn').hidden = !item;
  $('#itemDialog').showModal();
}
function closeDialog(id) { $(`#${id}`).close(); }
function updateItemQuantity(id, delta) {
  const item = items.find(x => x.id === id); if (!item) return;
  const result = roundQuantity(Math.max(0, Math.min(MAX_NUMBER, item.current + delta)));
  if (result === item.current) return;
  item.current = result; save(); render();
}
function handleAction(event) {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  if (action === 'new') return openItemDialog();
  if (action === 'edit') return openItemDialog(id);
  if (action === 'increase') return updateItemQuantity(id, 1);
  if (action === 'decrease') return updateItemQuantity(id, -1);
  if (action === 'bought') {
    const item = items.find(x => x.id === id);
    if (!item) return;
    item.current = item.max;
    save(); render(); toast(`${item.name} restocked to ${formatQuantity(item.max)}${pluralUnit(item,item.max)}`);
  }
}
function handleSubmit(event) {
  event.preventDefault();
  const name = $('#itemName').value.trim();
  const unit = $('#itemUnit').value.trim();
  const current = Number($('#itemCurrent').value);
  const min = Number($('#itemMin').value);
  const max = Number($('#itemMax').value);
  let error = '';
  if (!name) error = 'Enter an item name.';
  else if ([current,min,max].some((n,i) => !Number.isFinite(n) || ([$('#itemCurrent'),$('#itemMin'),$('#itemMax')][i]).value.trim() === '' || n < 0 || n > MAX_NUMBER)) error = 'Enter valid non-negative stock quantities.';
  else if ([current,min,max].some(n => roundQuantity(n) !== n)) error = 'Use no more than 2 decimal places.';
  else if (max <= 0) error = 'Maximum stock must be greater than zero.';
  else if (min > max) error = 'Minimum stock cannot exceed maximum stock.';
  else if (items.some(x => x.name.toLocaleLowerCase() === name.toLocaleLowerCase() && x.id !== editingId)) error = 'An item with this name already exists.';
  if (error) { $('#formError').textContent = error; $('#formError').hidden = false; return; }
  const updated = {id:editingId || makeId(),name,unit,current,min,max};
  const index = items.findIndex(x => x.id === editingId);
  if (index === -1) items.push(updated); else items[index] = updated;
  save(); closeDialog('itemDialog'); render(); toast(index === -1 ? 'Item added' : 'Item updated');
}
function exportBackup() {
  pantry.locations.find(loc => loc.id === activeLocation).items = items;
  const data = JSON.stringify({app:'Pantry Grocery Tracker',version:2,exportedAt:new Date().toISOString(),activeLocation,locations:pantry.locations},null,2);
  const url = URL.createObjectURL(new Blob([data], {type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = `pantry-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url),2000);
  toast('Backup ready to save');
}
async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 5000000) { toast('Backup file is too large'); return; }
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'Pantry Grocery Tracker') throw new Error('Invalid backup format');
    let restored;
    if (data.version === 2 && validateLocations(data)) {
      restored = structuredClone({version:2,activeLocation:data.activeLocation,locations:data.locations});
    } else if (data.version === 1 && validItemList(data.items)) {
      restored = defaultLocations(data.items); // Legacy backup imported into Location 1.
    } else throw new Error('Invalid backup format');
    const count = restored.locations.reduce((sum,loc) => sum + loc.items.length, 0);
    if (!confirm(`Replace BOTH locations with this backup (${count} total items)? Export your current backup first. This cannot be undone.`)) return;
    const previous = pantry, oldLocation = activeLocation, oldItems = items;
    pantry = restored;
    activeLocation = pantry.activeLocation;
    items = pantry.locations.find(loc => loc.id === activeLocation).items;
    if (!save()) { pantry = previous; activeLocation = oldLocation; items = oldItems; return; }
    closeDialog('settingsDialog'); searchTerm = ''; $('#searchInput').value = ''; render(); toast('Both locations restored');
  } catch (error) { console.error(error); toast('Invalid backup file'); }
}

$('#locationSelect').addEventListener('change', e => changeLocation(e.target.value));
$('#inventoryTab').addEventListener('click', () => { currentTab='inventory'; render(); });
$('#shoppingTab').addEventListener('click', () => { currentTab='shopping'; render(); });
$('#searchInput').addEventListener('input', e => { searchTerm=e.target.value.trim().toLocaleLowerCase(); render(); });
$('#addTopBtn').addEventListener('click', () => openItemDialog());
$('#floatingAdd').addEventListener('click', () => openItemDialog());
$('#settingsBtn').addEventListener('click', () => {
  $('#locationOneName').value = pantry.locations[0].name;
  $('#locationTwoName').value = pantry.locations[1].name;
  $('#settingsDialog').showModal();
});
$('#saveLocationsBtn').addEventListener('click', () => {
  const first = $('#locationOneName').value.trim();
  const second = $('#locationTwoName').value.trim();
  if (!first || !second || first.length > 40 || second.length > 40) { toast('Enter two location names (up to 40 characters).'); return; }
  const oldNames = pantry.locations.map(loc => loc.name);
  pantry.locations[0].name = first;
  pantry.locations[1].name = second;
  if (!save()) { pantry.locations.forEach((loc,i) => loc.name = oldNames[i]); return; }
  render(); toast('Location names saved');
});
$('#inventoryList').addEventListener('click', handleAction);
$('#shoppingList').addEventListener('click', handleAction);
$('#itemForm').addEventListener('submit', handleSubmit);
$('#deleteBtn').addEventListener('click', () => {
  const item = items.find(x => x.id === editingId); if (!item) return;
  if (!confirm(`Delete ${item.name} from your inventory?`)) return;
  items = items.filter(x => x.id !== editingId); save(); closeDialog('itemDialog'); render(); toast('Item deleted');
});
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeDialog(btn.dataset.close)));
['itemDialog','settingsDialog'].forEach(id => $("#"+id).addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); }));
$('#exportBtn').addEventListener('click', exportBackup);
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', importBackup);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('Offline setup failed',e)));
}
render();
