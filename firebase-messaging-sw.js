/* firebase-messaging-sw.js
 * Runs in the background (even with the app/tab closed) to receive push
 * notifications sent via Firebase Cloud Messaging and show them as native
 * OS notifications.
 *
 * This file MUST live at the root of the site (same level as index.html)
 * so its scope covers the whole origin.
 */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// Public web config — safe to expose (security is enforced by Firestore rules,
// not by hiding this). Keep this in sync with DEFAULT_FIREBASE_CONFIG in index.html.
firebase.initializeApp({
  apiKey: "AIzaSyBItEdFo7B_Ntku4-kYf2hRe7PoaY8ps5I",
  authDomain: "tracking-services-car.firebaseapp.com",
  projectId: "tracking-services-car",
  storageBucket: "tracking-services-car.firebasestorage.app",
  messagingSenderId: "329918900657",
  appId: "1:329918900657:web:7e03ef230d7429c4107590"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload){
  var title = (payload.notification && payload.notification.title) || "Service reminder";
  var body = (payload.notification && payload.notification.body) || "";
  var data = payload.data || {};
  self.registration.showNotification(title, {
    body: body,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag || "service-reminder",
    data: data
  });
});

// Clicking the notification focuses/opens the app.
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
      for (var i=0; i<list.length; i++){
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
