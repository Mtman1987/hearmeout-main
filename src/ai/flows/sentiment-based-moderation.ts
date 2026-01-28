'use server';

/**
 * @fileOverview A sentiment-based moderation AI agent.
 *
 * - moderateContent - A function that handles the content moderation process.
 * - ModerateContentInput - The input type for the moderateContent function.
 * - ModerateContentOutput - The return type for the moderateContent function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ModerateContentInputSchema = z.object({
  conversationHistory: z
    .string()
    .describe('The history of the conversation to analyze.'),
});
export type ModerateContentInput = z.infer<typeof ModerateContentInputSchema>;

const ModerateContentOutputSchema = z.object({
  overallSentiment: z
    .string()
    .describe('The overall sentiment of the conversation.'),
  isHarmful: z
    .boolean()
    .describe('Whether the content is potentially harmful or inappropriate.'),
  alertReason: z
    .string()
    .optional()
    .describe('The reason for the alert, if the content is harmful.'),
});
export type ModerateContentOutput = z.infer<typeof ModerateContentOutputSchema>;

export async function moderateContent(input: ModerateContentInput): Promise<ModerateContentOutput> {
  return moderateContentFlow(input);
}

const prompt = ai.definePrompt({
  name: 'moderateContentPrompt',
  input: {schema: ModerateContentInputSchema},
  output: {schema: ModerateContentOutputSchema},
  prompt: `You are an AI moderator responsible for analyzing the sentiment of conversations and flagging potentially harmful or inappropriate content.

Analyze the following conversation history and determine the overall sentiment. If the content is harmful or inappropriate, provide a reason for the alert.

Conversation History: {{{conversationHistory}}}

Respond in a structured JSON format:
{
  "overallSentiment": "[Overall sentiment of the conversation]",
  "isHarmful": [true/false],
  "alertReason": "[Reason for the alert, if the content is harmful]"
}`,
});

const moderateContentFlow = ai.defineFlow(
  {
    name: 'moderateContentFlow',
    inputSchema: ModerateContentInputSchema,
    outputSchema: ModerateContentOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
