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
- Leaderboards sync by link, not live. Each time someone shares a round, the others tap the link. A live, always-in-sync leaderboard would need a small backend with logins.
- Satellite imagery © Esri; course data © OpenStreetMap contributors; weather by Open-Meteo.
