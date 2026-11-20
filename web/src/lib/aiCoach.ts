import Anthropic from '@anthropic-ai/sdk';
import type { Round } from '../types';
import type { Coaching } from './analysis';

const SYSTEM = `You are an experienced Australian golf coach (PGA of Australia style) reviewing a club golfer's round.
Talk like a friendly Aussie coach: direct, warm, practical, no waffle. Use metres, Australian spelling, and Golf Australia terms (Daily Handicap, Stableford, Ambrose, GIR).
Ground every claim in the data supplied; quote hole numbers and stats. If the data is thin, say what to record next time.
Format your reply in simple Markdown with exactly these sections:
## Areas to focus on   (2 to 4 bullet points, biggest strokes first; name the pattern, the holes, and why it costs shots)
## Costliest holes     (up to 5 bullets: "Hole N (par P): score, what happened")
## What went well      (1 to 3 bullets)
## This week's practice plan  (a 60 to 90 minute session as numbered steps, with drills and targets)
## Next round game plan       (3 short on-course rules for the next round)
Keep the whole reply under 450 words.`;

export async function aiCoachReport(apiKey: string, round: Round, coaching: Coaching): Promise<string> {
  // Runs in the browser with the user's own key, stored only on this device.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const s = coaching.stats;
  const payload = {
    course: round.courseName,
    date: round.date,
    format: round.format,
    handicap: coaching.handicap,
    totals: {
      holes: s.holesPlayed,
      gross: s.gross,
      toPar: s.toPar,
      putts: s.putts,
      threePutts: s.threePutts,
      fairways: `${s.fairwaysHit}/${s.fairwayChances}`,
      missLeft: s.missLeft,
      missRight: s.missRight,
      gir: `${s.gir}/${s.girKnown}`,
      scrambling: `${s.scrambles}/${s.scrambleChances}`,
      penalties: s.penalties,
      sandSaves: `${s.sandSaves}/${s.sandHoles}`,
      front9ToPar: s.frontToPar,
      back9ToPar: s.backToPar,
      approachMisses: s.approachMisses,
    },
    typicalForHandicap: coaching.benchmark,
    holes: s.lines.map((l) => ({
      hole: l.hole.number,
      par: l.hole.par,
      si: l.hole.si,
      lengthM: l.hole.lengthM,
      score: l.gross,
      gir: l.gir,
      ...l.stats,
    })),
    weather: round.weather,
    ruleBasedFindings: coaching.focus.map((f) => ({ title: f.title, strokes: f.strokes, holes: f.holes })),
  };

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Here's my round. Coach me.\n\n\`\`\`json\n${JSON.stringify(payload, null, 1)}\n\`\`\``,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The AI coach declined this request. The built-in coaching above still applies.');
  }
  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  if (!text) throw new Error('The AI coach returned an empty reply. Try again.');
  return text;
}

export function describeAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Your Anthropic API key was rejected. Check it in Settings.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the AI service. Give it a minute and try again.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service. Check your signal and try again.';
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status ?? 'unknown'}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
