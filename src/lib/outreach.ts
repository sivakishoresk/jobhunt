// LinkedIn messages for a job. These are not cover letters: a stranger gives them a few seconds,
// so each one says who you are, which role, and what you are asking, and stops.
import { z } from 'zod';
import type { Profile } from './profile';
import { factScanner, type Check, type JobContext } from './facts';

/** LinkedIn cuts a connection note at 200 characters on free accounts and 300 on Premium. */
export const CONNECT_FREE = 200;
export const CONNECT_MAX = 300;
/** A direct message can be far longer, but past this it stops being read. */
export const MESSAGE_AIM = 600;

export const OUTREACH_KINDS = ['connect_note', 'message', 'referral_ask'] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];
export const OUTREACH_LABEL: Record<OutreachKind, string> = {
  connect_note: 'Connection note',
  message: 'Message to the recruiter or hiring manager',
  referral_ask: 'Referral ask',
};

export interface Outreach {
  connect_note: string;
  message: string;
  referral_ask: string;
  checks: Check[];
  updated_at: string | null;
}

export const OutreachInputSchema = z.object({
  connect_note: z.string().max(600).optional().describe(`Note sent with a connection request. ${CONNECT_FREE} characters or fewer (free accounts; Premium allows ${CONNECT_MAX}). One line on who you are with your single most relevant fact, and the role. No ask for a referral here.`),
  message: z.string().max(3000).optional().describe(`Direct message or InMail to the recruiter or hiring manager. Under ${MESSAGE_AIM} characters, 3 to 5 short sentences: the role, two facts that match what it asks for, one clear ask.`),
  referral_ask: z.string().max(3000).optional().describe(`Message to someone who works there, asking whether they would refer you or point you to the right person. Under ${MESSAGE_AIM} characters. Say why you fit in one sentence and make it easy to say no.`),
});
export type OutreachInput = z.infer<typeof OutreachInputSchema>;

export const OUTREACH_GUIDE = `LinkedIn messages are not cover letters. Write them straight to the point:
- Start with the point. No "I hope you are well", no "My name is" (LinkedIn shows it), no flattery, no "I am writing to".
- Name the exact role and company. Give at most two facts from the profile that match what the posting asks for, with a number where the profile has one. Do not retell the resume.
- End with one specific ask that takes a line to answer (for example: "Are you the right person to talk to about it?" or "Would you be open to referring me?").
- connect_note: ${CONNECT_FREE} characters or fewer, one or two sentences, no ask beyond connecting. message and referral_ask: under ${MESSAGE_AIM} characters, short sentences, plain words, no bullet lists, no bold, no emoji.
- Address the reader as "Hi [Name]," - the user fills in the name. Sign off with the user's first name only.
- Use ONLY facts from get_profile. Do not claim a mutual connection, a referral, or admiration for the company's work unless the user told you so.`;

export const EMPTY_OUTREACH: Outreach = { connect_note: '', message: '', referral_ask: '', checks: [], updated_at: null };

/** Reads what is stored for a job, tolerating rows written before this existed. */
export function outreachOf(v: unknown): Outreach {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Outreach>;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  return {
    connect_note: str(o.connect_note),
    message: str(o.message),
    referral_ask: str(o.referral_ask),
    checks: Array.isArray(o.checks) ? o.checks : [],
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : null,
  };
}

export const hasOutreach = (o: Outreach) => !!(o.connect_note.trim() || o.message.trim() || o.referral_ask.trim());

const FILLER: [RegExp, string][] = [
  [/\b(?:i\s+)?hope\b[^.!?\n]{0,50}\b(?:well|great|good)\b/i, 'Pleasantry'],
  [/\bi(?:'m| am) (?:writing|reaching out) to\b/i, 'Wind-up'],
  [/\bmy name is\b/i, 'LinkedIn already shows your name'],
  [/\bto whom it may concern\b/i, 'Formal greeting'],
  [/\b(?:sorry to bother|i know you(?:'re| are) (?:very )?busy|apologies for the (?:cold )?message)\b/i, 'Apology'],
  [/\b(?:passionate|thrilled|esteemed|synerg\w+|dream (?:job|company)|huge fan|pick your brain)\b/i, 'Filler'],
];

/** Length of a string the way LinkedIn counts it. */
export const chars = (s: string) => [...s.trim()].length;

/**
 * What to fix before sending: unsupported facts (same rule as resumes), anything over LinkedIn's limits,
 * filler, and a message with no ask.
 */
export function checkOutreach(profile: Profile, job: JobContext, o: Pick<Outreach, OutreachKind>): Check[] {
  const scan = factScanner(profile, job);
  const out: Check[] = [];
  for (const kind of OUTREACH_KINDS) {
    const text = o[kind].trim();
    if (!text) continue;
    const where = `LinkedIn · ${OUTREACH_LABEL[kind].toLowerCase()}`;
    const n = chars(text);
    if (kind === 'connect_note') {
      if (n > CONNECT_MAX) out.push({ where, text: `${n} characters`, issue: `Over ${CONNECT_MAX} characters: LinkedIn will not send this note.` });
      else if (n > CONNECT_FREE) out.push({ where, text: `${n} characters`, issue: `Over ${CONNECT_FREE} characters: too long for a free LinkedIn account (Premium allows ${CONNECT_MAX}).` });
    } else {
      if (n > MESSAGE_AIM) out.push({ where, text: `${n} characters`, issue: `Long for a LinkedIn message. Aim for under ${MESSAGE_AIM} characters.` });
      if (!text.includes('?')) out.push({ where, text: 'No question', issue: 'There is no ask. End with one clear question.' });
    }
    for (const [re, label] of FILLER) {
      const m = re.exec(text);
      if (m) out.push({ where, text: m[0], issue: `${label}. Cut it and start with the point.` });
    }
    // Placeholders such as [Name] and the greeting are not claims.
    const body = text.replace(/\[[^\]\n]{0,40}\]/g, ' ').replace(/^\s*(?:hi|hello|hey|dear)\b[^,\n]{0,40},?\s*/i, '');
    out.push(...scan(where, body));
  }
  return out.slice(0, 30);
}

/** Merges new text over what is stored (a field that is not sent keeps its text) and re-checks all of it. */
export function mergeOutreach(profile: Profile, job: JobContext, current: Outreach, patch: OutreachInput): Outreach {
  const next = {
    connect_note: patch.connect_note ?? current.connect_note,
    message: patch.message ?? current.message,
    referral_ask: patch.referral_ask ?? current.referral_ask,
  };
  return { ...next, checks: checkOutreach(profile, job, next), updated_at: new Date().toISOString() };
}
