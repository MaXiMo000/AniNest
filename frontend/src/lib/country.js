// The viewer's country, for filtering free official uploads by YouTube's
// region lists. Guessed from the time zone first (browser language is often
// en-US everywhere), then the language's region; the viewer can change it,
// and the choice is kept in this browser.

const ZONES = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID',
  'Asia/Manila': 'PH', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Saigon': 'VN', 'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Taipei': 'TW', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR',
  'Asia/Shanghai': 'CN', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Kathmandu': 'NP', 'Asia/Colombo': 'LK',
  'Asia/Yangon': 'MM', 'Asia/Phnom_Penh': 'KH', 'Asia/Vientiane': 'LA', 'Asia/Brunei': 'BN', 'Asia/Thimphu': 'BT',
  'Indian/Maldives': 'MV', 'Asia/Ulaanbaatar': 'MN', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA',
  'Asia/Kuwait': 'KW', 'Asia/Jerusalem': 'IL', 'Europe/Istanbul': 'TR', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Pacific/Auckland': 'NZ',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Lisbon': 'PT', 'Europe/Warsaw': 'PL',
  'Europe/Stockholm': 'SE', 'Europe/Moscow': 'RU', 'Africa/Johannesburg': 'ZA', 'Africa/Lagos': 'NG', 'Africa/Cairo': 'EG',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Phoenix': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA',
  'America/Vancouver': 'CA', 'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR',
  'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL',
};

const KEY = 'aninest:country';
const names = new Intl.DisplayNames(undefined, { type: 'region' });

export const countryName = (code) => (code ? names.of(code) : 'your country');

// Every country the picker offers, sorted by name.
export const COUNTRIES = [...new Set(Object.values(ZONES))].sort((a, b) => countryName(a).localeCompare(countryName(b)));

function guess() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (ZONES[zone]) return ZONES[zone];
  const region = /-([A-Z]{2})$/.exec(navigator.language || '')?.[1];
  return region || null;
}

export function getCountry() {
  try {
    const saved = localStorage.getItem(KEY);
    if (/^[A-Z]{2}$/.test(saved || '')) return saved;
  } catch { /* storage blocked: fall back to the guess */ }
  return guess();
}

export function setCountry(code) {
  try { localStorage.setItem(KEY, code); } catch { /* not remembered, still applied this time */ }
}

// YouTube's regionRestriction semantics: a blocklist, or an allowlist, or neither.
export function playableIn(source, country) {
  if (!country) return true;
  if (source.blocked_regions?.includes(country)) return false;
  if (source.allowed_regions && !source.allowed_regions.includes(country)) return false;
  return true;
}
