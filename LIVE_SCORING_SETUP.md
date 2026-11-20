# Live scoring setup (one-off, about 5 minutes)

Live scoring uses a free Firebase Realtime Database. You only do this once, and your mates never need to.

## 1. Create the Firebase project
1. Go to https://console.firebase.google.com and sign in with a Google account.
2. **Create a project** and call it something like `fairway-coach`. You can switch Google Analytics off.

## 2. Turn on anonymous sign-in
This lets phones connect without anyone making an account.
1. In the left menu, go to **Build → Authentication → Get started**.
2. On the **Sign-in method** tab, choose **Anonymous**, switch it on and **Save**.
3. On the **Settings** tab, go to **Authorized domains → Add domain** and add `toddy55.github.io` (the address the app is published at).

## 3. Create the database
1. Go to **Build → Realtime Database → Create database**.
2. For the location, choose **Singapore (asia-southeast1)**, the closest to Australia.
3. Choose **Start in locked mode**.
4. Open the **Rules** tab, replace everything with the contents of [`database.rules.json`](database.rules.json) and click **Publish**.

The rules mean that each scorer can only change their own group's card, anyone with the code can watch (or join as another group's scorer), and nobody can list or browse other rounds.

## 4. Connect the app
1. Click the gear icon, then **Project settings → General → Your apps**. Click the **Web** icon `</>`, give it a nickname and click **Register app**. You don't need Firebase Hosting.
2. Copy the `firebaseConfig` values it shows. They look like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "fairway-coach.firebaseapp.com",
     databaseURL: "https://fairway-coach-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "fairway-coach",
     appId: "1:123:web:abc"
   };
   ```
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   - Name: `VITE_FIREBASE_CONFIG`
   - Value: the same values as JSON (every key and value in double quotes), e.g.
     `{"apiKey":"AIza...","authDomain":"fairway-coach.firebaseapp.com","databaseURL":"https://fairway-coach-default-rtdb.asia-southeast1.firebasedatabase.app","projectId":"fairway-coach","appId":"1:123:web:abc"}`
4. Re-run the **Deploy to GitHub Pages** workflow (Actions tab), or just push a change.

The Firebase web config is not a secret: it identifies the project, and the database rules control access. Alternatively, paste it into `web/src/live/config.ts` (`PASTED_CONFIG`).

## Using it on the day
- **First group's scorer:** start the round, tap **Go live** on the hole screen and share the link to the group chat.
- **Other groups' scorers:** open the link, tap **I'm scoring another group**, add your group's players and tee off. Your card joins the same leaderboard.
- **Everyone else:** open the link (or type the code under "Watch a live round" on the home screen) and leave it open.
- **After the round:** everyone (scorers too) taps **Add the full-field round to my app**, so the comp ranks the whole field together.

## Cost
Firebase's free Spark plan covers 1 GB stored and 10 GB downloaded a month. A live round is a few KB per update, so a weekly group will use a tiny fraction of that.
