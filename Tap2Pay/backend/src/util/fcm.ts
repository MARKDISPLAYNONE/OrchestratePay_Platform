/**
 * util/fcm.ts — Firebase Cloud Messaging push notification helper.
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON env var (JSON string of the service
 * account credentials file downloaded from Firebase Console).
 * If not set, all calls are silently no-ops — FCM is gracefully disabled.
 *
 * Install: npm install firebase-admin
 */
import { logger } from './logger'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _messaging: any = null

function getMessaging() {
  if (_messaging) return _messaging

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!json) return null

  try {
    // Dynamic require so the server starts even if firebase-admin is not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const admin = require('firebase-admin')
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) })
    }
    _messaging = admin.messaging()
    logger.info('Firebase Admin SDK initialized')
    return _messaging
  } catch (err: any) {
    logger.warn('Firebase Admin SDK unavailable — FCM disabled', { error: err.message })
    return null
  }
}

export interface FcmPayload {
  fcmToken:    string
  title:       string
  body:        string
  data?:       Record<string, string>
}

/**
 * Sends a high-priority FCM push notification.
 * Returns true on success, false if FCM is disabled or the send fails.
 * Never throws — all errors are logged and swallowed.
 */
export async function sendFcmNotification(payload: FcmPayload): Promise<boolean> {
  const messaging = getMessaging()
  if (!messaging) return false

  try {
    await messaging.send({
      token:        payload.fcmToken,
      notification: { title: payload.title, body: payload.body },
      data:         payload.data,
      android: {
        priority:     'high',
        notification: { sound: 'default', channelId: 'payments' },
      },
    })
    return true
  } catch (err: any) {
    logger.warn('FCM send failed', { error: err.message })
    return false
  }
}
