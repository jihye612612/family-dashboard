/* 우리 가족 기록장 — 알림 전용 서비스 워커
 * 안드로이드 크롬(휴대폰)은 페이지에서 만든 new Notification()을 막기 때문에,
 * 상단 알림은 이 서비스 워커의 showNotification()으로 띄웁니다.
 * 캐시는 하지 않고(always network) 알림 클릭 시 열려 있는 창을 앞으로 가져오기만 해요.
 */
'use strict';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      try {
        await c.focus();
        c.postMessage({ type: 'fd-focus-chat' });   // 앱이 채팅으로 스크롤해 줘요
        return;
      } catch (e) {}
    }
    const url = (list[0] && list[0].url) || self.registration.scope;
    await self.clients.openWindow(url);
  })());
});
