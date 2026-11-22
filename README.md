# Fairway Coach

A phone-first golf app for Australian golfers. It scores every common format, gives GPS distances to the front, centre, back and pin, shows live wind with a "plays like" number, and coaches you on what to fix after every round.

It runs in the browser and installs to your home screen (Share → Add to Home Screen on iPhone). Everything is saved on your phone, so it keeps working out on the course with no reception.

## Features

**Scoring (Golf Australia rules)**
- Stroke (gross and net), Stableford, Par, Match play (singles or better-ball pairs), 4BBB Stableford, Skins (gross or net, with carry-overs)
- Ambrose for 2, 3 or 4-person teams. Team handicap is combined Daily Handicaps ÷ 4, ÷ 6 or ÷ 8, and it tracks whose drive was used
- Daily Handicap = GA Handicap × Slope ÷ 113 + (Scratch Rating − Par), with 9-hole support and an adjustable allowance for each format
- Shots allocated by stroke index, plus handicaps included

**Courses**
- Search any course in Australia by name, or find courses near you
- Hole-by-hole data (par, stroke index, tee-to-green lines, green outlines) comes from OpenStreetMap
- Course editor: fix pars and stroke indexes, add scratch and slope ratings, and place greens or tees by tapping the satellite map or standing on them

**On course**
- Live front, centre and back distances along your line of play, plus distance to the pin once you drop it on the map
- Tap anywhere on the satellite map to measure you → point → green (layups, carries)
- Live wind, gusts and temperature (Open-Meteo), with an arrow showing the wind relative to your shot
- A "plays like" distance adjusted for wind, elevation change and temperature, plus how far to aim off for crosswind
- Shot tracker: mark each shot with the club you used and it builds your average club distances
- Keeps the screen awake during a round

**Friends & leaderboards**
- Friends list with GA handicaps, rounds together and a head-to-head record (Stableford) against each mate
- Comps for your regular group, e.g. a Friday Arvo League. Set an agreed length (start/end dates and/or a number of rounds), "best N rounds count", and the minimum players for a round to count
- Scoring options: league points by finishing position (custom points table, points for playing, birdie bonus), total Stableford, average Stableford (with a minimum rounds to qualify), or average net
- Ambrose rounds count in league mode, with team-mates sharing the team's position. Ties share the points
- Rounds are tagged to comps at setup (ticked automatically when enough members are playing) and can be changed after the round
- All-time table across your whole crew, plus live comps on the home screen
- **Watch your mates without a link:** rounds go live by themselves (Settings → Live rounds to turn it off). When a friend tees off, your Home screen shows "🔴 Jarrod is live at Nambour… Watch" with a pop-up, and one tap opens their live scorecard and shot cam. Friends swap a private channel when they link up (and through comps and shared rounds), so only friends see it
- **No-typing invites:** put your mate's name in the invite (or pick one contact and it fills in). They tap the link and they're linked up as that name straight away, even on a brand-new phone, and you get a pop-up ("🤝 Jarrod linked up with you") on whatever screen you're on
- **Linking up as friends, automatically:** "Invite mates to the app" sends a link-up link. When your mate opens it they're linked straight away: you're added to their Friends and they're added to yours. If the app is brand new to them it just asks their name first. Comp invites work the same way
- **iPhone tip built in:** the Home Screen app on an iPhone has its own storage, separate from Safari. Invite screens opened in Safari on an iPhone show three steps: copy the invite, Add to Home Screen, then open the app and tap **Paste an invite**. Every invite message says the same
- **Invites by text or email:** Friends → "Invite mates to the app", or a comp's "Invite a mate to join". On Android, "Choose from my contacts" lets you tick several mates at once; on iPhone, tap Text with no number and add mates from your contacts in Messages. Or type mobile numbers (opens Messages) or email addresses (opens your email), or use Share / Copy. Every invite includes the steps to add the app to their home screen on iPhone and Android
- **Invite a mate to a comp:** "Invite a mate to join" sends a link. Your mate taps it, sees the comp and the table so far, puts in their name and handicap and taps Join. They appear in the comp on everyone's phone by themselves (or, without live sync set up, they send an "I'm in" link back)
- **Live in the comp:** when a round that counts towards a comp goes live, the comp page on everyone's phone shows a **Live now** card with the leaderboard (thru, points or net to par) and the comp table "if it finished now", updating as the scorer enters scores
- **Tournament rules:** whoever set up the comp can choose *Everything on*, *AI caddy off* (no club or aim advice, which the Rules of Golf treat as advice) or *Distances only* (also no plays-like, wind or slope, like a rangefinder under the distance-measuring-device local rule). It applies to every round in the comp on everyone's phone, updates live, and only the organiser can change it
- **Banter:** every comp has its own group chat. Golf and stirring emojis (🐦🦆🐔🐐🌊🏖️🤡💀🍻 and more), one-tap sledges ("Sandbagger alert 🚨", "Wet one! 🌊", "Is that your score or your handicap? 🤣"…) and automatic shout-outs when someone birdies or blows up a hole during a live comp round. The comp page shows the latest message and how many are new
- **Sharing, no accounts needed:** "Share round" or "Sync rounds" makes a link for the group chat. Opening it on a mate's phone imports the rounds and comp, matching players by name (confirmable), skipping rounds they already scored themselves, and keeping their own stats private. "Share table" posts the standings as text

**Live scoring**
- The chosen scorer taps **Go live** on the hole screen and shares the link (or the 8-letter code). Everyone with it open sees scores, the leaderboard and the "if it finished now" comp table update within about a second of each score going in
- No logins for anyone. If the scorer loses signal, scores queue on their phone and send when it's back
- **More than one group, or playing another team?** Each group has its own scorer. The other group's scorer opens the same link and taps "Join with my group or team" (course, format and holes are copied across). Both scorers' **Scorecard** tab then shows every team hole by hole (Everyone / Our group), updating as each side enters scores: ideal for an Ambrose or a 4BBB against another group. Everyone sees one combined leaderboard for the whole field, which hole each group is on, and the comp table ranked across all groups
- **Cross-marking (no scoring yourself):** in any game or comp, if a second phone in the same group opens the live link and taps "I'm in Toddy's group: I'll mark the other side", every phone marks the other side and never its own. Your own row locks ("🔒 marked by Shazza") and fills in from their phone as they enter it. Players without a phone are shared out between the phones. With one phone scoring, it works as before
- When everyone's finished, tap "Add the full-field round to my app". For scorers it replaces their own group's card, keeping their personal stats
- Needs a free Firebase project, a one-off setup: see [LIVE_SCORING_SETUP.md](LIVE_SCORING_SETUP.md)

**Shot tracer**
- **Video tracer:** film a shot (or pick a video), tap where the ball starts, lands and peaks, and a TV-style tracer follows the ball in time with the video. Choose the colour and thickness, then save the clip or share it to the group chat
- **Sim mode (fully automatic):** stand the phone on the bag 2 to 4 m behind the ball, pointing down the target line, and hit. No tapping: it hears the strike, finds the ball (it spots it sitting at address), follows it frame by frame and draws the tracer live. It then fits a real ball-flight model (speed, launch, spin, start line, curve) to what the camera saw, finishes the tracer to the landing spot, and shows **carry, apex, hang time, start line, shape (draw/fade/hook/slice) and where it landed**. A dispersion chart plots the session, and it re-arms itself for the next shot
  - Pick the club: ball speed is the hardest thing for a camera to see from behind, so the club's typical speed is the starting point
  - **Calibrate** once with a shot of known carry. It learns how much harder or softer than a typical club golfer you hit it, and that applies to every club
  - Accuracy on simulated test footage: landing side within about 6 m; carry within a few percent for typical club golfers, about 5–12% before calibration for stronger hitters; real-world accuracy depends on a still phone and a ball that stands out
- **Shot cam for mates watching live:** during a live round, every sim shot is turned into a small traced clip (about 360p, a few seconds, under 500 KB) and sent to the live round. Everyone watching the live card or the comp's Live now card sees it play by itself the moment it lands, with the club, carry, apex and shape, and can flick back through the last few. In a comp round the banter gets a "📹 Toddy: 7i · Carry 128 m. Watch it" shout-out. Switch it off on the sim screen
- **GPS tracer:** shots marked during a round are drawn as curved flight lines on the satellite map with club and distance, plus a hole-by-hole animated **shot replay** after the round

**Hole view**
- Each hole is a full-size satellite picture turned so you're looking down it: tee at the bottom, green at the top, doglegs and all
- Front, centre (or pin) and back distances down the side, plus the plays-like number; the hole number, par, length and stroke index; and the wind arrow turned to match the hole
- Pinch to zoom (up to 10x) and drag to look around, or use the + / − / Fit buttons
- Tap anywhere to drop a target: you get the distance to it and from it to the pin. Drag the target ring to move it
- Every bunker and water hazard in play shows two numbers: how far to reach it and how far to carry it. Rings across the fairway mark every 50 m (or yards)
- The caddy's club, aim line and landing zone sit on the picture, with its call along the bottom
- On Queensland courses the photos come from the Queensland Government's aerial imagery (down to about 15 cm per pixel, much sharper than the global satellite photos). The **Qld HD / Esri** button swaps between them, since they're taken at different times and one may be more up to date. The app picks the sharpest zoom your phone's screen can show
- **Green** zooms in on the green; **Pin** lets you tap where today's flag is; swipe between holes with the arrows by the hole number

**Green slope maps (Queensland)**
- Tap **Green** on the hole view: the green is coloured by slope (green flat, yellow 2%, orange 3%, red 4.5%+), with arrows showing which way it falls and contour lines every 10 cm
- Tap where your ball is (or stand on the green) for a **putt read**: length, how much uphill or downhill, which way it breaks and roughly how many cups to aim outside the hole, with the curve drawn on the green
- The caddy adds where to miss each approach from how the green falls around the pin (e.g. "falls back to front: stay below the hole")
- Uses the Queensland Government's free LiDAR elevation model (0.5–1 m), so it works on Queensland courses. Each green is fetched once and kept on the phone. It's survey data, not a green-book: it won't show recent green rebuilds or tiny breaks, and the putt break is a rule-of-thumb estimate for medium-paced greens
- Off when a comp's tournament rules are "AI caddy off" or "Distances only"

**AI caddy**
- On every hole: the club and the exact aim point (e.g. "7-iron, aim 6 m left of the pin, pin-high"), the plays-like distance, and the odds of finding water or sand
- How it decides: it plays each sensible club and aim line a few hundred times with your distance, spread and usual miss (from your shot tracker, sim calibration and stats), plus wind, slope and temperature. Every landing spot is scored with the expected strokes to hole out (green, fairway, rough, bunker or water) and the option that saves the most shots wins. It lays up when going for it doesn't pay, and plays safer after a blow-up or when you're protecting a good card
- The map shows the aim point, the landing zone and the bunkers, water and fairways
- "Ask the caddy" chats about the shot with Claude (needs your Anthropic key)
- Green slopes aren't in public map data, so it doesn't read the break

**Scorecards (pars and stroke indexes)**
- Pars come from OpenStreetMap. Where a course was mapped without pars, the app works them out from each hole's length (under 230 m a par 3, over 430 m a par 5, otherwise a par 4; right on about 93% of SEQ holes that do have pars) and marks them *est.*
- The course page has a quick **Scorecard** editor: tap 3 / 4 / 5 for each hole and type the stroke index, then **Matches the club card**. Your card is then kept as you set it
- Courses saved on your phone, and a round in progress, pick up corrected pars automatically (unless you've edited the card). Setup and the hole view flag estimated pars

**Handicaps**
- Each player (you in Settings, mates under Friends, or when joining a comp) is either **GA Handicap** or **No GA handicap**
- GA Handicap: add their 10-digit GA number and tap **Check it on Golf Australia** to open their official record, then enter the GA Handicap shown. It's flagged ⏰ if it hasn't been checked in a week (GA Handicaps change after every round), and Setup warns before you tee off
- No GA handicap: a manual handicap agreed with the group, shown as "manual". Plus handicaps: type +2.1
- Daily Handicaps use the course's slope and scratch ratings when they're set

**Coaching**
- Mid-round, net scores are fair: an Ambrose team's handicap comes off pro rata for the holes played (half after 9), and the leader shows as e.g. "2.5 under net thru 9"
- Built-in coach (no internet or key needed): compares your putts, fairways, GIR, up-and-downs, penalties, bunker play, blow-up holes, par-5 scoring and back-nine fade against typical numbers for your handicap. It ranks the areas costing you the most shots, lists your costliest holes and why, gives a drill and an on-course tip for each, and builds a 60-minute practice plan
- Optional AI coach: a deeper Claude write-up of the round, using your own Anthropic API key (Settings)
- Stats page: trends over your last 10 rounds, your recurring #1 weakness, and club distances
- **"Hey Siri, mark shot"** (iPhone): a short Shortcut asks "Which club?", then posts where you're standing and the club ("seven iron", "56", "the big dog") to your private address while the phone stays in your pocket. When you next open the round, each mark drops into the right hole as a shot with the club. Set it up in Play → Shot tracker → "Mark shots hands-free"

## Run it

```bash
cd web
npm install
npm run dev      # local dev server
npm test         # unit tests (scoring, handicaps, GPS maths, coaching)
npm run build    # production build in web/dist
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. Turn it on under repo **Settings → Pages → Source: GitHub Actions**. GPS needs HTTPS, which Pages provides.

**Database rules:** after changing `database.rules.json`, paste it into Firebase console → Realtime Database → Rules → Publish (it isn't deployed automatically). The `marks` section is what lets Siri Shortcuts post shots without signing in: write-once, only `lat`, `lon` and `club`, and only to a private key 16 or more characters long.

## Notes and limits

- Course detail depends on what's mapped in OpenStreetMap. Popular courses are usually complete; for others, map the greens once in the course editor and they're saved for next time. Check pars and stroke indexes against the club scorecard.
- Handicap allowances default to 100% (85% for 4BBB) and can be changed for each round to match your club's conditions of play.
- The "plays like" maths uses caddie rules of thumb and the coach's benchmarks are typical amateur averages. Treat both as a guide, not gospel.
- Data is stored on the device. Use Settings → Export backup now and then.
- Comp tables sync by link, or by watching a live round and saving it.
- Satellite imagery © Esri; course data © OpenStreetMap contributors; weather by Open-Meteo.
