// src/i18n/index.ts
//
// i18next setup. Language = the user's saved choice, else the phone's
// language if we have it, else English. Import this module once (App.tsx)
// before any screen renders. Components use `useTranslation('<namespace>')`;
// services outside React use `i18n.t('<namespace>:<key>')`.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';
import { resources, NAMESPACES } from './locales';
import { ALL_LANGUAGES, matchLocale, Language } from './languages';

const LANGUAGE_KEY = '@app_language';

// Languages that actually have translations bundled.
export const LANGUAGES: Language[] = ALL_LANGUAGES.filter(l => l.code in resources);

const isSupported = (code: string | null | undefined): code is string =>
  !!code && LANGUAGES.some(l => l.code === code);

const isRTL = (code: string) => !!LANGUAGES.find(l => l.code === code)?.rtl;

function deviceLanguage(): string {
  const locale = Localization.getLocales()[0];
  const code = matchLocale(locale?.languageCode, locale?.regionCode);
  return isSupported(code) ? code : 'en';
}

i18n.use(initReactI18next).init({
  resources,
  ns: [...NAMESPACES],
  defaultNS: 'common',
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

// Layout direction can only change on the next app start (React Native rule).
// Returns true if the user needs to restart for the new direction to apply.
function applyDirection(code: string): boolean {
  const rtl = isRTL(code);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
}

// Applies a previously saved manual choice (async, so it runs just after start-up).
export async function loadSavedLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (isSupported(saved) && saved !== i18n.language) await i18n.changeLanguage(saved);
  } catch {
    // keep the device/default language
  }
  applyDirection(i18n.language);
}

// Returns true if the app must be restarted to switch layout direction.
export async function setLanguage(code: string): Promise<boolean> {
  if (!isSupported(code)) return false;
  await i18n.changeLanguage(code);
  await AsyncStorage.setItem(LANGUAGE_KEY, code).catch(() => {});
  return applyDirection(code);
}

export default i18n;
