/* global firebase, importScripts, clients */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyALb75Yter7DvLpkbx_HoW_h_jD0a3eWZY',
  authDomain: 'easyboard-sg.firebaseapp.com',
  projectId: 'easyboard-sg',
  messagingSenderId: '334251499398',
  appId: '1:334251499398:web:066dccb38abc415f4a1607'
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage(payload => {
  const notification = payload.notification || {}
  self.registration.showNotification(notification.title || 'EasyBoard', {
    body: notification.body || 'You have a new update.',
    data: payload.data || {}
  })
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/home'))
})
