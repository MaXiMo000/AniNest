import { escapeHtml } from './ui.js';

// A themed replacement for native <select>. A plain <select>'s closed
// trigger can be restyled with CSS, but its OPEN options list is rendered
// by the OS/browser chrome and can't be reskinned at all - that's the part
// that looks out of place against this app's comic UI. Renders as a button
// + a custom <ul> options list, backed by a real hidden <input> so existing
// code that reads `element.value` (e.g. the review form) keeps working
// completely unchanged.
export function powSelectHTML({ id, options, value }) {
  const selected = options.find((o) => String(o.value) === String(value)) || options[0];
  return `
    <div class="pow-select" data-pow-select>
      <button type="button" class="pow-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="pow-select-trigger-label">${escapeHtml(selected?.label ?? '')}</span>
        <span class="pow-select-arrow">▾</span>
      </button>
      <ul class="pow-select-options" role="listbox" hidden>
        ${options.map((o) => `<li role="option" data-value="${escapeHtml(String(o.value))}" class="${String(o.value) === String(selected?.value) ? 'is-selected' : ''}">${escapeHtml(o.label)}</li>`).join('')}
      </ul>
      <input type="hidden" id="${id}" value="${escapeHtml(String(selected?.value ?? ''))}" />
    </div>`;
}

function closeAllPowSelects() {
  document.querySelectorAll('.pow-select-options').forEach((list) => { list.hidden = true; });
  document.querySelectorAll('.pow-select-trigger').forEach((t) => t.setAttribute('aria-expanded', 'false'));
}

// Wired ONCE, at document level - not on #app. A click on the header/nav/
// footer is outside #app and would never bubble through an #app-scoped
// listener, so "click outside closes the list" needs the real document
// root to work for every part of the page, not just app content.
export function wirePowSelects() {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.pow-select-trigger');
    const option = e.target.closest('.pow-select-options li');

    if (trigger) {
      const select = trigger.closest('.pow-select');
      const list = select.querySelector('.pow-select-options');
      const wasOpen = !list.hidden;
      closeAllPowSelects();
      if (!wasOpen) {
        list.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    if (option) {
      const select = option.closest('.pow-select');
      const input = select.querySelector('input[type="hidden"]');
      const label = select.querySelector('.pow-select-trigger-label');
      input.value = option.dataset.value;
      label.textContent = option.textContent;
      select.querySelectorAll('li').forEach((li) => li.classList.remove('is-selected'));
      option.classList.add('is-selected');
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closeAllPowSelects();
      return;
    }

    closeAllPowSelects();
  });
}
