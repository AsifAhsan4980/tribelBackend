const admin = require('firebase-admin');

let firebaseApp = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (!projectId || !privateKey || !clientEmail) {
    console.warn('Firebase credentials not configured. Push notifications will be unavailable.');
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        privateKey: privateKey.replace(/\\n/g, '\n'),
        clientEmail,
      }),
    });
    console.log('Firebase Admin initialized successfully');
  } catch (err) {
    console.error('Failed to initialize Firebase Admin:', err.message);
  }

  return firebaseApp;
};

initFirebase();

const getMessaging = () => {
  if (!firebaseApp) return null;
  return admin.messaging();
};

module.exports = { getMessaging };
