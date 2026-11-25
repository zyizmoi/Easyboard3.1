/* global self, clients */
/* eslint-disable no-undef */

// This worker is intentionally project-agnostic. The app contains the Firebase
// config and asks FCM for a token; the browser delivers the resulting web push
// to this worker. That keeps staging and production from sharing a hard-coded
// project.

self.addEventListener('push', event => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { notification: { body: event.data ? event.data.text() : '' } }
  }

  const notification = payload.notification || {}
  const data = payload.data || {}
  const title = notification.title || data.title || 'EasyBoard'
  const body = notification.body || data.body || 'You have a new update.'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      tag: data.type || 'easyboard'
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/home'))
})
