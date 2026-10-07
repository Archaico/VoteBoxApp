// src/i18n/locales/index.ts
//
// Registry of every bundled translation. One JSON file per namespace per
// language (src/i18n/locales/<lang>/<namespace>.json), so different screens
// can be translated independently. English is the source of truth; other
// languages are added here as they are translated.

import enCommon from './en/common.json';
import enAuth from './en/auth.json';
import enList from './en/list.json';
import enCreate from './en/create.json';
import enVoting from './en/voting.json';
import enDiscussion from './en/discussion.json';
import enNotifications from './en/notifications.json';
import enShare from './en/share.json';

export const NAMESPACES = ['common', 'auth', 'list', 'create', 'voting', 'discussion', 'notifications', 'share'] as const;

export const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    list: enList,
    create: enCreate,
    voting: enVoting,
    discussion: enDiscussion,
    notifications: enNotifications,
    share: enShare,
  },
};

// Shown in the language picker, in each language's own name.
export const LANGUAGES: { code: string; nativeName: string; rtl?: boolean }[] = [
  { code: 'en', nativeName: 'English' },
];
