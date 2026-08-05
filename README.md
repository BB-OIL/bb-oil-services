# BB-OIL Services

A lightweight vehicle service-tracking app for oil-change and auto-service stations. Station owners can manage customers, vehicles, and service history; customers can sign in to view their own vehicles and upcoming maintenance. Built as a single-page app backed by Firebase (Auth + Firestore), deployable to Firebase Hosting.

## Features

- 🔐 **Email/password authentication** with sign up, sign in, and password reset
- 👥 **Two roles**: station owner (admin) and customer, with separate views
- 🚗 **Vehicle & service tracking** — log service records per vehicle with due-date/mileage reminders for common service types (oil change, tire rotation, brake inspection, etc.)
- 🌍 **Multi-language UI** — English, French, and Arabic (with RTL support)
- ⚡ **No build step** — a single `index.html` file plus a pre-bundled Firebase client library
- ☁️ **Firebase Hosting + Firestore** for data storage and static hosting

## Tech stack

- Vanilla JavaScript (no framework, no bundler required to run)
- [Firebase](https://firebase.google.com/) — Authentication, Firestore, Hosting
- `firebase-bundle.js` — a pre-built, tree-shaken bundle of the Firebase Web SDK modules the app actually uses

## Project structure

```
.
├── index.html          # The entire app (UI, logic, styles)
├── firebase-bundle.js  # Pre-bundled Firebase SDK (app, firestore, auth modules)
├── firebase.json        # Firebase Hosting configuration
├── firestore.rules      # Firestore security rules
├── _firebaserc           # Firebase project alias
└── favicon.svg
```

## Getting started

### 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new project.
2. Enable **Authentication** → Email/Password sign-in method.
3. Enable **Firestore Database** (start in production mode).
4. Register a **Web App** in your project settings to get your Firebase config object (`apiKey`, `authDomain`, `projectId`, etc.).

### 2. Configure the app

Open `index.html` and locate `DEFAULT_FIREBASE_CONFIG` (or connect via the in-app "Connect database" screen on first load) and paste in your project's config:

```js
var DEFAULT_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

Update `_firebaserc` with your Firebase project ID:

```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

### 3. Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

### 4. Deploy hosting

```bash
firebase deploy --only hosting
```

### 5. Run locally

Because the app uses ES modules (`import`), it must be served over HTTP — opening `index.html` directly via `file://` will not work reliably. Use any static server, e.g.:

```bash
npx serve .
# or
firebase emulators:start --only hosting
```

## Push notifications (service due / overdue) — free setup

The app can send a real push notification to your device — even when the browser is closed — when a service becomes due soon or overdue. **This whole setup is free** — Firestore, Hosting, Auth, and sending push notifications are all free on Firebase's Spark (no-cost) plan. The one thing that *would* need the paid Blaze plan is Firebase Cloud Functions, so instead the periodic check runs as a free scheduled **GitHub Actions** workflow.

**1. Get a Firebase service account key** (lets the script talk to Firestore/FCM on your behalf):
Firebase Console → ⚙️ Project settings → **Service accounts** → **Generate new private key**. This downloads a JSON file — keep it secret, never commit it.

**2. Add it as a GitHub secret:**
In your GitHub repo → Settings → Secrets and variables → Actions → **New repository secret** → name it `FIREBASE_SERVICE_ACCOUNT` → paste the *entire contents* of the JSON file as the value.

**3. Get a Web Push VAPID key** (for the browser side):
Firebase Console → Project settings → **Cloud Messaging** → *Web Push certificates* → **Generate key pair**. Paste it into `index.html`, replacing:
```js
var VAPID_KEY = "REPLACE_WITH_YOUR_VAPID_KEY";
```

**4. Commit and push these files** (already included in this repo):
- `.github/workflows/service-reminders.yml` — the scheduled workflow (runs every 12 hours, and can also be triggered manually from the Actions tab)
- `scripts/check-reminders.js` + `scripts/package.json` — the check itself
- `firebase-messaging-sw.js` — must be deployed at the site root so it can be reached at `/firebase-messaging-sw.js`

**5. Deploy hosting and rules as usual:**
```bash
firebase deploy --only hosting,firestore:rules
```

**6. In the app**, sign in and click **🔔 Enable notifications** — this registers your device and saves a token to Firestore.

How it works:
- The GitHub Actions workflow runs `scripts/check-reminders.js` on a schedule, which recomputes each vehicle's service status (same logic as the in-app reminders) and sends a push the first time a service crosses into "due soon" or "overdue" — it won't notify you again on every run.
- Device tokens live in a `pushTokens` Firestore collection, keyed by token, tied to the signed-in user's email.
- `firebase-messaging-sw.js` shows the notification when the app isn't in the foreground; `onMessage` in `index.html` shows it when the app is open.

A couple of GitHub Actions quirks worth knowing: scheduled runs can be delayed a few minutes during high load, and GitHub auto-disables a scheduled workflow if the *repository* has had no commits/activity for 60 days (a manual "Enable workflow" click in the Actions tab turns it back on — no code changes needed).

<details>
<summary>Have a paid Blaze plan? You can use a Cloud Function instead</summary>

A ready-made Cloud Function equivalent (`functions/index.js`) is also included, using `onSchedule` from `firebase-functions/v2/scheduler`. If you'd rather run it that way:

```bash
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules
```

This is functionally identical to the GitHub Actions script above — pick whichever fits your setup.
</details>

## Notes

- `firebase-bundle.js` only exports the specific Firebase SDK functions the app calls. If you add new Firebase functionality, you'll need to re-bundle it to include the new exports.
- Password reset is implemented via a direct call to the [Identity Toolkit REST API](https://firebase.google.com/docs/reference/rest/auth) using the project's `apiKey`, rather than the SDK's `sendPasswordResetEmail`, to avoid depending on functions not included in the trimmed bundle.

## License

This project is licensed under the MIT License — see [LICENSE](./LICENSE) for details.
