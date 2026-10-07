// src/i18n/languages.ts
//
// Every language the app can offer, with its name in that language. Only the
// ones that have translation files (see ./locales/index.ts) appear in the
// picker. Codes follow BCP 47; i18next uses them as resource keys.

export interface Language {
  code: string;
  nativeName: string;
  rtl?: boolean;
}

export const ALL_LANGUAGES: Language[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'it', nativeName: 'Italiano' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)' },
  { code: 'pt-PT', nativeName: 'Português (Portugal)' },
  { code: 'nl', nativeName: 'Nederlands' },
  { code: 'sv', nativeName: 'Svenska' },
  { code: 'nb', nativeName: 'Norsk' },
  { code: 'da', nativeName: 'Dansk' },
  { code: 'fi', nativeName: 'Suomi' },
  { code: 'pl', nativeName: 'Polski' },
  { code: 'el', nativeName: 'Ελληνικά' },
  { code: 'ru', nativeName: 'Русский' },
  { code: 'ar', nativeName: 'العربية', rtl: true },
  { code: 'hi', nativeName: 'हिन्दी' },
  { code: 'bn', nativeName: 'বাংলা' },
  { code: 'zh-Hans', nativeName: '简体中文' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'ko', nativeName: '한국어' },
  { code: 'sw', nativeName: 'Kiswahili' },
  { code: 'ha', nativeName: 'Hausa' },
];

// Countries that use European Portuguese (everyone else gets Brazilian).
const EUROPEAN_PORTUGUESE_REGIONS = ['PT', 'AO', 'MZ', 'GW', 'CV', 'ST', 'TL', 'MO'];

// Maps a device locale (language + region) to one of our codes, or null.
export function matchLocale(languageCode: string | null | undefined, regionCode: string | null | undefined): string | null {
  if (!languageCode) return null;
  const lang = languageCode.toLowerCase();
  if (lang === 'pt') return regionCode && EUROPEAN_PORTUGUESE_REGIONS.includes(regionCode.toUpperCase()) ? 'pt-PT' : 'pt-BR';
  if (lang === 'zh') return 'zh-Hans'; // only Simplified Chinese is offered
  if (lang === 'no' || lang === 'nn') return 'nb'; // Norwegian variants → Bokmål
  return ALL_LANGUAGES.some(l => l.code === lang) ? lang : null;
}
