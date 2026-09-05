// functions/index.js
//
// Fires whenever CIDRegistryService.setCID() writes a new comment-thread CID
// (src/services/CIDRegistryService.ts, collection `comment_cids`). Looks up
// everyone subscribed to that proposal (src/services/NotificationService.ts's
// registerPushToken(), collection `proposal_subscribers`) and pushes them a
// "new comment" notification via Expo's push service.

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

exports.notifyNewComment = onDocumentWritten('comment_cids/{proposalId}', async (event) => {
  const { proposalId } = event.params;

  const subscribersRef = db.collection('proposal_subscribers').doc(proposalId);
  const subscribersDoc = await subscribersRef.get();
  if (!subscribersDoc.exists) return;
  const title = subscribersDoc.data()?.title ?? 'a proposal';

  const tokensSnap = await subscribersRef.collection('tokens').get();
  if (tokensSnap.empty) return;

  const messages = tokensSnap.docs.map((tokenDoc) => ({
    to: tokenDoc.id,
    title: 'New comment on proposal',
    body: title,
    data: { type: 'new_comment', proposalId },
  }));

  // Expo's push API accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error('[notifyNewComment] Expo push API error:', res.status, await res.text());
    }
  }
});
