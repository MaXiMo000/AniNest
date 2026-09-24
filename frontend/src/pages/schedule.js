import { Api } from '../lib/api.js';
import { cardGrid, skeletonGrid, errorHTML, escapeHtml, wireRetry } from '../lib/ui.js';
import { navigate } from '../lib/router.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABEL = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

export function todayName() {
  // JS getDay(): 0=Sunday..6=Saturday — map to our lowercase weekday keys.
  return DAYS[(new Date().getDay() + 6) % 7];
}

function tabsHTML(activeDay) {
  const today = todayName();
  return `
    <div class="genre-filter-list" role="tablist" aria-label="Day of week">
      ${DAYS.map((d) => `
        <button class="chip ${d === activeDay ? 'active' : ''}" data-day="${d}">
          ${escapeHtml(DAY_LABEL[d])}${d === today ? ' 🔴' : ''}
        </button>
      `).join('')}
    </div>
  `;
}

export async function renderSchedule(root, params) {
  document.title = 'Weekly Schedule — AniNest';
  const requested = (params.get('day') || '').toLowerCase();
  const day = DAYS.includes(requested) ? requested : todayName();

  root.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">📅 Weekly Schedule</h2>
      <span class="section-sub">${day === todayName() ? "Today's lineup" : `What airs on ${DAY_LABEL[day]}`}</span>
    </div>
    ${tabsHTML(day)}
    <div id="schedule-grid">${skeletonGrid(12)}</div>
  `;
  wireTabs(root);

  try {
    const { data } = await Api.schedule(day);
    const grid = root.querySelector('#schedule-grid');
    if (grid) grid.innerHTML = cardGrid(data);
  } catch (err) {
    console.error(err);
    const grid = root.querySelector('#schedule-grid');
    if (grid) grid.innerHTML = errorHTML("Couldn't load this day's schedule — the anime API may be busy.");
    wireRetry(root, () => renderSchedule(root, params));
  }
}

function wireTabs(root) {
  root.querySelectorAll('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`#/schedule?day=${btn.dataset.day}`));
  });
}
