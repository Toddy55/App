import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are an experienced Australian caddy on the bag for a club golfer, mid-round.
Talk like a good caddy: calm, confident, practical, Aussie but professional. Short answers (2 to 5 sentences), no lists unless asked.
You are given the caddy engine's numbers for this shot (club, aim point, plays-like distance, wind, hazards and the odds of finding them, the golfer's tendencies, how the round is going). Base your advice on those numbers; don't invent yardages or hazards that aren't in the data.
You can't see green slopes, so don't claim to read the break. If something isn't in the data, say so briefly and give the safe default.`;

export async function askCaddy(apiKey: string, context: unknown, question: string): Promise<string> {
  // Runs in the browser with the golfer's own key, stored only on this phone.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Shot situation:\n\`\`\`json\n${JSON.stringify(context, null, 1)}\n\`\`\`\n\nMy question: ${question}`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') throw new Error("The caddy couldn't answer that one.");
  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  if (!text) throw new Error('No answer came back. Try again.');
  return text;
}

export { describeAiError } from './aiCoach';
