/** How to play each format and comp game, in plain golf talk (for the little ⓘ). */
export interface GameHelp {
  title: string;
  players: string;
  play: string[];
  scoring: string[];
  example?: string;
  tip?: string;
}

export const GAME_HELP: Record<string, GameHelp> = {
  // ---- Round formats ----
  stroke: {
    title: 'Stroke play',
    players: '1 or more',
    play: ['Everyone plays their own ball and counts every shot, penalties included, until it’s in the hole.'],
    scoring: ['Gross = every shot you took.', 'Net = gross minus your playing handicap.', 'Lowest net wins (or lowest gross, for scratch).'],
    example: 'You shoot 92 off a playing handicap of 18: net 74.',
  },
  stableford: {
    title: 'Stableford',
    players: '1 or more',
    play: ['Play your own ball. Once you can’t score a point on a hole, pick up and move on: it speeds things up.'],
    scoring: [
      'Points per hole on your net score (after handicap strokes):',
      'Net double bogey or worse = 0 · net bogey = 1 · net par = 2 · net birdie = 3 · net eagle = 4.',
      'Most points wins. 36 is playing to your handicap.',
    ],
    example: 'Par 4, you get a stroke and make 5: net 4, a net par, 2 points.',
  },
  par: {
    title: 'Par (v. par)',
    players: '1 or more',
    play: ['Play every hole against par, off your handicap.'],
    scoring: ['Beat par on a hole (net): +1. Lose to it: −1. Equal: 0.', 'Add them up: "+2" means you beat the course by 2 holes.'],
    example: 'Net birdie +1, net par 0, net bogey −1.',
  },
  matchplay: {
    title: 'Match play',
    players: '2 (singles) or 4 (two pairs)',
    play: ['Hole by hole against your opponent. Lowest net score on a hole wins it. Same score halves it.'],
    scoring: ['You’re "up" by the number of holes you’ve won more than them.', 'It’s over once someone is up by more holes than are left, e.g. "3&2".'],
    example: '2 up with 1 to play: halve the last and you win 2 up.',
  },
  fourball: {
    title: '4BBB Stableford (better ball)',
    players: '2 pairs',
    play: ['Two-person teams. Everyone plays their own ball the whole way.'],
    scoring: ['On each hole, the team scores the better of its two players’ Stableford points.', 'Usually played off 85% of handicap.'],
    example: 'You get 1 point, your partner gets 3: the team scores 3.',
    tip: 'Partners take turns being the "safe" one: if your mate’s in trouble, play for the green.',
  },
  ambrose: {
    title: 'Ambrose (scramble)',
    players: 'Teams of 2, 3 or 4',
    play: ['Everyone tees off, the team picks the best ball, and everyone plays their next shot from there. Repeat until it’s holed.', 'Most comps ask for a set number of each player’s drives.'],
    scoring: ['One team score per hole.', 'Team handicap = total of everyone’s daily handicaps divided by 2× the team size (4-person: ÷8, 2-person: ÷4).', 'Lowest net team score wins.'],
    example: '4-person team, handicaps 10+14+18+22 = 64, ÷8 = team handicap 8.',
  },
  skins: {
    title: 'Skins',
    players: '2 or more',
    play: ['Everyone plays their own ball. Each hole is worth a skin.'],
    scoring: [
      'Best score on a hole on your own wins the skin.',
      'If two or more tie for best, nobody wins it and it carries over: the next hole is worth 2 skins, and so on.',
      'Most skins wins (or you play for a dollar a skin).',
    ],
    example: 'Holes 4 and 5 tie, you win 6 outright: that’s 3 skins.',
  },
  // ---- Comp scoring ----
  league: {
    title: 'League points',
    players: 'Any',
    play: ['Each round everyone is ranked on their Stableford (Ambrose: team net).'],
    scoring: ['Points by finishing position, e.g. 10 for 1st, 8 for 2nd, 6 for 3rd, plus points just for playing and any birdie bonus.', 'Most points over the season wins.'],
    tip: 'Use "best N rounds" so missing a week doesn’t kill your chances.',
  },
  stableford_total: {
    title: 'Total Stableford',
    players: 'Any',
    play: ['Play Stableford every round.'],
    scoring: ['Add up all your Stableford points across the season.', 'Rewards turning up, so pair it with "best N rounds" to keep it fair.'],
  },
  stableford_avg: {
    title: 'Average Stableford',
    players: 'Any',
    play: ['Play Stableford every round.'],
    scoring: ['Your average points per round.', 'You need a minimum number of rounds to qualify, so one hot round can’t win it.'],
  },
  net_avg: {
    title: 'Average net score',
    players: 'Any',
    play: ['Stroke play rounds.'],
    scoring: ['Your average net score per round, lowest wins.', 'Best for 18-hole rounds.'],
  },
  nassau: {
    title: 'Nassau',
    players: '2 to 4',
    play: ['Everyone plays their own ball. Each pair of players has three separate matches running at once.'],
    scoring: ['Front 9 match, back 9 match and the overall 18: hole by hole, net.', 'Win a match: 1 point. Halve it: ½ each.', 'With 3 or 4 players, everyone plays everyone.'],
    example: 'Win the front, lose the back, win the 18: 2 points to 1.',
    tip: 'Down early? You can still nick the back 9 and the 18.',
  },
  sixes: {
    title: 'Sixes',
    players: 'Exactly 4',
    play: ['Four players, three 6-hole matches, and your partner changes each time (in the order you’re listed): holes 1–6 A & B v C & D, 7–12 A & C v B & D, 13–18 A & D v B & C.'],
    scoring: ['Better ball, net: the team’s best score on each hole counts.', 'Win the 6-hole match: 1 point each. Halve it: ½.', 'Most points after 18 wins.'],
    tip: 'Everyone partners everyone once, so a good day carries any partner.',
  },
  nines: {
    title: 'Nines (5-3-1)',
    players: 'Exactly 3',
    play: ['Three players, everyone plays their own ball.'],
    scoring: ['9 points on every hole, on net scores: best 5, second 3, third 1.', 'Ties share: two tied for best get 4 each and third gets 1; all three tied get 3 each.', 'Most points after 18 wins (162 are up for grabs).'],
    example: 'You make net 3, they make 4 and 5: you 5, them 3 and 1.',
  },
};
