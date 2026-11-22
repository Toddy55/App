export interface LatLon {
  lat: number;
  lon: number;
}

export interface Green {
  centre: LatLon;
  /** Outline of the putting surface, if known (from OpenStreetMap or mapped by the user). */
  polygon?: LatLon[];
}

export interface Hole {
  number: number;
  par: number;
  /** Stroke index (1 = hardest). */
  si: number;
  lengthM?: number;
  tee?: LatLon;
  green?: Green;
  /** Line of play from tee to green, including any dogleg. */
  path?: LatLon[];
  /** Par worked out from the hole's length (the map data had none): check against the club card. */
  parEst?: boolean;
  /** Stroke index missing from the map data (just the hole number): check against the club card. */
  siEst?: boolean;
}

export type HazardKind = 'bunker' | 'water' | 'fairway';

/** Bunkers, water and fairways, used by the caddy for course management. */
export interface Hazard {
  kind: HazardKind;
  poly: LatLon[];
}

export interface Course {
  id: string;
  name: string;
  state?: string;
  suburb?: string;
  location?: LatLon;
  holes: Hole[];
  hazards?: Hazard[];
  /** Golf Australia scratch rating for the tee you play. */
  scratchRating?: number;
  /** Golf Australia slope rating for the tee you play (113 = neutral). */
  slopeRating?: number;
  source: 'osm' | 'manual';
  osmRef?: string;
  /** The scorecard (pars and stroke indexes) has been checked or edited by hand: don't overwrite it. */
  cardEdited?: boolean;
  updatedAt: number;
}

export interface Player {
  id: string;
  name: string;
  /** GA Handicap (index). Negative for plus markers. */
  gaHandicap: number;
  /** Golf Australia (GOLF Link) number, 10 digits, for checking the official handicap. */
  gaNumber?: string;
  /** 'ga' = official GA Handicap; 'manual' = no GA handicap, a number the group agreed on. */
  hcpSource?: 'ga' | 'manual';
  /** When the GA Handicap was last checked against Golf Australia. */
  hcpCheckedAt?: number;
  /** Their phone's crew code: lets this phone see when they're playing live. */
  crew?: string;
  /** When they linked up with you through an invite (shows a "new" badge for a couple of days). */
  linkedAt?: number;
}

export type Format =
  | 'stroke'
  | 'stableford'
  | 'par'
  | 'matchplay'
  | 'fourball'
  | 'ambrose'
  | 'skins';

export interface RoundPlayer {
  id: string;
  name: string;
  gaHandicap: number;
  dailyHandicap: number;
  /** Daily handicap after the format's handicap allowance, rounded. */
  playingHandicap: number;
  teamId?: string;
}

export interface Team {
  id: string;
  name: string;
  playerIds: string[];
  /** Ambrose team handicap (can be fractional, e.g. 4.5). */
  handicap: number;
}

export type FairwayResult = 'hit' | 'left' | 'right' | 'na';
export type ApproachMiss = 'short' | 'long' | 'left' | 'right';

export interface HoleStats {
  putts?: number;
  fairway?: FairwayResult;
  penalties?: number;
  /** Greenside bunker shots played. */
  sand?: number;
  approachMiss?: ApproachMiss;
  /** Length of first putt in metres. */
  firstPuttM?: number;
  teeClub?: string;
  /** Ambrose: whose drive the team used. */
  drivePlayerId?: string;
}

export interface Shot {
  lat: number;
  lon: number;
  club?: string;
  t: number;
  /** Marked by "Hey Siri, mark shot" (phone in the pocket). */
  voice?: boolean;
}

export interface WeatherSnapshot {
  t: number;
  windKmh: number;
  gustKmh: number;
  /** Direction the wind is blowing FROM, degrees true. */
  windFromDeg: number;
  tempC: number;
}

export interface RoundOptions {
  /** Handicap allowance percentage applied to daily handicaps (e.g. 100, 85). */
  allowance: number;
  skinsNet: boolean;
  skinsCarryOver: boolean;
  ambroseSize?: 2 | 3 | 4;
}

export interface Round {
  id: string;
  courseId: string;
  courseName: string;
  date: string;
  format: Format;
  holes: Hole[];
  players: RoundPlayer[];
  teams?: Team[];
  /** Id of the player (or team, in Ambrose) the stats and coaching belong to. */
  meId: string;
  /** scores[sideId][holeNumber] = gross strokes. Side is a player, or a team for Ambrose. */
  scores: Record<string, Record<number, number>>;
  stats: Record<number, HoleStats>;
  shots: Record<number, Shot[]>;
  /** Siri marks already added to this round (their ids). */
  siriMarks?: string[];
  pins: Record<number, LatLon>;
  /** When each pin was marked (newest wins across the field). */
  pinsAt?: Record<number, number>;
  /** Who marked it, when it came from another phone. */
  pinsBy?: Record<number, string>;
  /** Where your ball is on the green, marked by standing on it (per hole). */
  balls?: Record<number, LatLon>;
  options: RoundOptions;
  weather?: WeatherSnapshot;
  completed: boolean;
  aiReport?: string;
  /** Competitions (leaderboards) this round counts towards. */
  compIds?: string[];
  /** Name of the mate who shared this round to this phone. */
  sharedBy?: string;
  /** Code of the live scoring session, if the scorer has gone live. */
  liveCode?: string;
  /** This phone's group within the live event (each group has its own scorer). */
  liveGroup?: string;
  /** Cross-marking: this phone marks the same card as another group's scorer (that group's id). */
  liveSameAs?: string;
  /** Not saved: when set, only these holes are counted (used for mid-round "if it finished now" tables). */
  scoreHoles?: number[];
  startedAt: number;
  finishedAt?: number;
}

export interface Settings {
  me: Player;
  units: 'm' | 'yd';
  /** Every round goes live by itself so friends can watch (default on). */
  shareLive?: boolean;
  anthropicKey?: string;
  clubs: string[];
  /** Your own stock distance per club (total, metres), e.g. checked with a rangefinder. */
  myDistances?: Record<string, number>;
}

export type CompScoring = 'league' | 'stableford_total' | 'stableford_avg' | 'net_avg';

/** A season-long comp between mates, e.g. "Friday Arvo League". */
export interface Competition {
  id: string;
  name: string;
  memberIds: string[];
  /** ISO date (yyyy-mm-dd), inclusive. */
  start: string;
  /** ISO date (yyyy-mm-dd), inclusive. Optional for open-ended comps. */
  end?: string;
  /** Season ends after this many rounds have been counted. */
  roundLimit?: number;
  /** Only each player's best N rounds count. */
  countBest?: number;
  scoring: CompScoring;
  /** League: points for 1st, 2nd, 3rd… in each round. */
  pointsTable: number[];
  /** League: points just for playing. */
  participationPoints: number;
  /** League: bonus points per gross birdie or better. */
  birdieBonus: number;
  /** A round only counts when at least this many members played it. */
  minPlayers: number;
  /** Averages: rounds needed to qualify for the table. */
  minRounds: number;
  holes: 'any' | '18' | '9';
  createdAt: number;
  /** Name of whoever set the comp up; only they can change the tournament rules. */
  organiser?: string;
  /**
   * Tournament rules for rounds in this comp: 'full' = everything on;
   * 'noCaddy' = no AI caddy (club and aim advice); 'distancesOnly' = also no
   * plays-like, wind or slope (a plain GPS rangefinder).
   */
  aids?: Aids;
}

export type Aids = 'full' | 'noCaddy' | 'distancesOnly';
