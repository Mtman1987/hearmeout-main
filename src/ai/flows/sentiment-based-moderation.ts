'use server';

import { z } from 'zod';

const ModerateContentInputSchema = z.object({
  conversationHistory: z.string().describe('The history of the conversation to analyze.'),
});
export type ModerateContentInput = z.infer<typeof ModerateContentInputSchema>;

const ModerateContentOutputSchema = z.object({
  overallSentiment: z.string().describe('The overall sentiment of the conversation.'),
  isHarmful: z.boolean().describe('Whether the content is potentially harmful or inappropriate.'),
  alertReason: z.string().optional().describe('The reason for the alert, if the content is harmful.'),
});
export type ModerateContentOutput = z.infer<typeof ModerateContentOutputSchema>;

export async function moderateContent(): Promise<ModerateContentOutput> {
  // Genkit disabled - returning safe default
  return { overallSentiment: 'Neutral', isHarmful: false };
}
