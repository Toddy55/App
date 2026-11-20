# Live scoring setup (one-off, about 5 minutes)

Live scoring needs a free Firebase database. You do this once, on a computer (it's easier than on a phone). Your mates never need to do anything.

## Step 1: Create a project
1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project** (or **Get started**).
3. Name it `fairway-coach` and click **Continue**.
4. When it asks about **Google Analytics**, switch it **off**, then click **Create project**. When it's done, click **Continue**.

## Step 2: Turn on sign-in
1. In the left-hand menu, click **Build**, then **Authentication**, then **Get started**.
2. Under **Native providers**, click **Anonymous**, flick the switch to **Enable**, and click **Save**.

## Step 3: Create the database
1. In the left-hand menu, click **Build**, then **Realtime Database**, then **Create Database**.
2. For the location, pick **Singapore**, then click **Next**.
3. Leave **Start in locked mode** selected and click **Enable**.
4. Click the **Rules** tab at the top. Select everything in the box, delete it, and paste this in:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "events": {
      "$code": {
        ".read": "auth != null && $code.length >= 6",
        "groups": {
          "$group": {
            ".write": "auth != null && $group.length <= 12 && (!data.exists() || data.child('owner').val() === auth.uid)",
            ".validate": "newData.hasChildren(['owner', 'data', 'status', 'updatedAt']) && newData.child('owner').val() === auth.uid && newData.child('data').isString() && newData.child('data').val().length < 300000",
            "status": { ".validate": "newData.val() === 'live' || newData.val() === 'final'" }
          }
        }
      }
    }
  }
}
```

5. Click **Publish**.

These rules mean each scorer can only change their own group's card, anyone with the code can watch, and nobody can browse other people's rounds.

## Step 4: Get the config and send it to Thoth
1. Click the **gear icon** next to "Project Overview" at the top left, then **Project settings**.
2. Scroll down to **Your apps** and click the **`</>`** (Web) icon.
3. Type a nickname (e.g. `fairway`). Leave "Firebase Hosting" **unticked** and click **Register app**.
4. You'll see a block of code containing `const firebaseConfig = { ... }`. **Copy that block and paste it into the chat with Thoth.** It's fine to share: it's not a password, and the rules above control who can do what.

Thoth puts it into the app and republishes. Live scoring then appears on everyone's phone.

---

### Doing it yourself instead of sending it to Thoth
Put the values in `web/src/live/config.ts` (`PASTED_CONFIG`), or add them as JSON in a GitHub repository variable named `VITE_FIREBASE_CONFIG` (**Settings → Secrets and variables → Actions → Variables**), then re-run the **Deploy to GitHub Pages** workflow.

### Cost
The free Spark plan covers 1 GB stored and 10 GB downloaded a month. A live round is a few KB per update, so a weekly group uses a tiny fraction of that.
