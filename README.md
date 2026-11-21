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
- **Sharing, no accounts needed:** "Share round" or "Invite / sync mates" makes a link for the group chat. Opening it on a mate's phone imports the rounds and comp, matching players by name (confirmable), skipping rounds they already scored themselves, and keeping their own stats private. "Share table" posts the standings as text

**Live scoring**
- The chosen scorer taps **Go live** on the hole screen and shares the link (or the 8-letter code). Everyone with it open sees scores, the leaderboard and the "if it finished now" comp table update within about a second of each score going in
- No logins for anyone. If the scorer loses signal, scores queue on their phone and send when it's back
- **More than one group?** Each group has its own scorer. The second group's scorer opens the same link and taps "I'm scoring another group" (course, format and holes are copied across). Everyone sees one combined leaderboard for the whole field, which hole each group is on, and the comp table ranked across all groups
- When everyone's finished, tap "Add the full-field round to my app". For scorers it replaces their own group's card, keeping their personal stats
- Needs a free Firebase project, a one-off setup: see [LIVE_SCORING_SETUP.md](LIVE_SCORING_SETUP.md)

**Shot tracer**
- **Video tracer:** film a shot (or pick a video), tap where the ball starts, lands and peaks, and a TV-style tracer follows the ball in time with the video. Choose the colour and thickness, then save the clip or share it to the group chat
- **Sim mode (fully automatic):** stand the phone on the bag 2 to 4 m behind the ball, pointing down the target line, and hit. No tapping: it hears the strike, finds the ball (it spots it sitting at address), follows it frame by frame and draws the tracer live. It then fits a real ball-flight model (speed, launch, spin, start line, curve) to what the camera saw, finishes the tracer to the landing spot, and shows **carry, apex, hang time, start line, shape (draw/fade/hook/slice) and where it landed**. A dispersion chart plots the session, and it re-arms itself for the next shot
  - Pick the club: ball speed is the hardest thing for a camera to see from behind, so the club's typical speed is the starting point
  - **Calibrate** once with a shot of known carry. It learns how much harder or softer than a typical club golfer you hit it, and that applies to every club
  - Accuracy on simulated test footage: landing side within about 6 m; carry within a few percent for typical club golfers, about 5–12% before calibration for stronger hitters; real-world accuracy depends on a still phone and a ball that stands out
- **GPS tracer:** shots marked during a round are drawn as curved flight lines on the satellite map with club and distance, plus a hole-by-hole animated **shot replay** after the round

**Hole view**
- Each hole is a full-size satellite picture turned so you're looking down it: tee at the bottom, green at the top, doglegs and all
- Front, centre (or pin) and back distances down the side, plus the plays-like number; the hole number, par, length and stroke index; and the wind arrow turned to match the hole
- Tap anywhere to drop a target: you get the distance to it and from it to the pin. Drag the target ring to move it
- Every bunker and water hazard in play shows two numbers: how far to reach it and how far to carry it. Rings across the fairway mark every 50 m (or yards)
- The caddy's club, aim line and landing zone sit on the picture, with its call along the bottom
- **Green** zooms in on the green; **Pin** lets you tap where today's flag is; swipe between holes with the arrows by the hole number

**AI caddy**
- On every hole: the club and the exact aim point (e.g. "7-iron, aim 6 m left of the pin, pin-high"), the plays-like distance, and the odds of finding water or sand
- How it decides: it plays each sensible club and aim line a few hundred times with your distance, spread and usual miss (from your shot tracker, sim calibration and stats), plus wind, slope and temperature. Every landing spot is scored with the expected strokes to hole out (green, fairway, rough, bunker or water) and the option that saves the most shots wins. It lays up when going for it doesn't pay, and plays safer after a blow-up or when you're protecting a good card
- The map shows the aim point, the landing zone and the bunkers, water and fairways
- "Ask the caddy" chats about the shot with Claude (needs your Anthropic key)
- Green slopes aren't in public map data, so it doesn't read the break

**Coaching**
- Built-in coach (no internet or key needed): compares your putts, fairways, GIR, up-and-downs, penalties, bunker play, blow-up holes, par-5 scoring and back-nine fade against typical numbers for your handicap. It ranks the areas costing you the most shots, lists your costliest holes and why, gives a drill and an on-course tip for each, and builds a 60-minute practice plan
- Optional AI coach: a deeper Claude write-up of the round, using your own Anthropic API key (Settings)
- Stats page: trends over your last 10 rounds, your recurring #1 weakness, and club distances

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

## Notes and limits

- Course detail depends on what's mapped in OpenStreetMap. Popular courses are usually complete; for others, map the greens once in the course editor and they're saved for next time. Check pars and stroke indexes against the club scorecard.
- Handicap allowances default to 100% (85% for 4BBB) and can be changed for each round to match your club's conditions of play.
- The "plays like" maths uses caddie rules of thumb and the coach's benchmarks are typical amateur averages. Treat both as a guide, not gospel.
- Data is stored on the device. Use Settings → Export backup now and then.
- Comp tables sync by link, or by watching a live round and saving it.
- Satellite imagery © Esri; course data © OpenStreetMap contributors; weather by Open-Meteo.
