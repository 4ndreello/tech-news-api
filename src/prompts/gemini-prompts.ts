/**
 * Gemini AI Prompts Configuration
 *
 * Centralized prompt templates for AI operations
 */

export const GeminiPrompts = {
  /**
   * Summarizes content in Portuguese (BR)
   * Used for: Highlight summaries
   */
  summarize: (text: string) => `Resuma o texto abaixo em um parágrafo claro, objetivo e SEM ENROLAÇÃO, em português do Brasil. Não repita o título. Foque no conteúdo relevante para tecnologia e desenvolvimento. Use até 14 frases.

${text}`,

  /**
   * Analyzes tech relevance of content
   * Used for: Filtering TabNews posts
   * Returns: 0-100 score
   */
  analyzeTechRelevance: (title: string, body: string) => `Analise se o conteúdo abaixo é relacionado a TECNOLOGIA (programação, desenvolvimento, software, hardware, IA, cloud, DevOps, engenharia de software, ciência da computação, segurança digital, etc).

TÍTULO: ${title}

CONTEÚDO: ${body.slice(0, 2000)}

Responda APENAS com um número de 0 a 100:
- 0-30: Não é sobre tecnologia (política, economia, investimentos, notícias gerais)
- 31-60: Parcialmente relacionado (menção superficial a tech)
- 61-100: Claramente sobre tecnologia (conteúdo técnico, tutoriais, discussões de dev)

RESPONDA APENAS O NÚMERO, SEM TEXTO ADICIONAL.`,
} as const;
