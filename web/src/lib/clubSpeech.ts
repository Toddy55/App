/**
 * Turn what you said to Siri ("seven iron", "3 wood", "sand wedge", "56 degree")
 * into one of the clubs in your bag.
 */
const NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8', ninth: '9',
};

/** A short code for a club: "7i", "3w", "4h", "driver", "pw", "gw", "sw", "lw", "putter". */
export function clubCode(text: string): string {
  let s = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  for (const [w, d] of Object.entries(NUMBERS)) s = s.replace(new RegExp(` ${w} `, 'g'), ` ${d} `);
  s = s
    .replace(/ (big dog|one wood|1 wood|drive) /g, ' driver ')
    .replace(/ (flat ?stick|putt) /g, ' putter ')
    .replace(/ (pitching|pitch|p) wedge | pw /g, ' pw ')
    .replace(/ (gap|approach|a|g) wedge | (aw|gw) /g, ' gw ')
    .replace(/ (sand|s) wedge | sand | sw /g, ' sw ')
    .replace(/ (lob|l) wedge | lob | lw /g, ' lw ');
  s = s.replace(/ (\d{2}) ?(degree|degrees|deg)? /g, (_, d: string) => {
    const n = Number(d);
    return n >= 44 && n <= 48 ? ' pw ' : n >= 49 && n <= 53 ? ' gw ' : n >= 54 && n <= 57 ? ' sw ' : n >= 58 && n <= 64 ? ' lw ' : ` ${d} `;
  });
  s = s
    .replace(/ (\d) ?(iron|irons|i) /g, ' $1i ')
    .replace(/ (\d) ?(wood|woods|w|fairway) /g, ' $1w ')
    .replace(/ (\d) ?(hybrid|rescue|utility|h) /g, ' $1h ')
    .replace(/ (hybrid|rescue|utility) /g, ' h ');
  const words = s.trim().split(/\s+/);
  const known = words.find((w) => /^(driver|putter|pw|gw|sw|lw|\d+[iwh]|h)$/.test(w));
  if (known) return known;
  // Just a number ("seven"): an iron
  const n = words.find((w) => /^\d$/.test(w));
  return n ? `${n}i` : words.join(' ');
}

/** The club in your bag that matches what you said, or what you said if nothing matches. */
export function clubFromSpeech(spoken: string, clubs: string[]): string | undefined {
  const said = spoken.trim().slice(0, 40);
  if (!said) return undefined;
  const code = clubCode(said);
  const bag = clubs.map((c) => ({ c, code: clubCode(c) }));
  const exact = bag.find((b) => b.code === code);
  if (exact) return exact.c;
  // "4 hybrid" when the bag just says "Hybrid" (and the other way round)
  if (/^\d*h$/.test(code)) {
    const h = bag.filter((b) => /^\d*h$/.test(b.code));
    if (h.length === 1) return h[0].c;
  }
  return said;
}
