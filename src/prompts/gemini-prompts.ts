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
  summarize: (
    text: string,
  ) => `Resuma o texto abaixo em um parágrafo claro, objetivo e SEM ENROLAÇÃO, em português do Brasil. Não repita o título. Foque no conteúdo relevante para tecnologia e desenvolvimento. Use até 14 frases.

${text}`,

  /**
   * Analyzes tech relevance of content
   * Used for: Filtering TabNews posts
   * Returns: 0-100 score
   */
  analyzeTechRelevance: (
    title: string,
    body: string,
  ) => `Analise a relevância e a qualidade do conteúdo de tecnologia abaixo. Foque em artigos que promovam 'knowledge sharing' para profissionais de tecnologia, especialmente na área de desenvolvimento WEB e tecnologia em geral.

Evite conteúdo 'slop', como:
- Posts sobre carreira, burnout ou histórias pessoais ("Estou desistindo de TI").
- Tutoriais muito básicos ("Como fazer um 'Hello World'").
- Listas genéricas ("5 melhores frameworks de 2026").
- Notícias de tecnologia sem profundidade técnica.

Privilegie:
- Análises técnicas profundas.
- Anúncios de novas tecnologias, bibliotecas ou produtos relevantes.
- Discussões sobre arquitetura de software, design patterns e boas práticas.
- Artigos sobre performance, segurança e escalabilidade.

TÍTULO: ${title}

CONTEÚDO: ${body.slice(0, 2000)}

Responda APENAS com um número de 0 a 100, onde a pontuação reflete a qualidade e relevância para um desenvolvedor experiente:
- 0-40: Não é sobre tecnologia ou é 'slop' (conteúdo de baixa qualidade, carreira, muito básico).
- 41-70: Relevante para tecnologia, mas pode ser superficial ou notícia geral sem análise técnica.
- 71-90: Conteúdo técnico de alta qualidade, útil para o dia-a-dia de um desenvolvedor.
- 91-100: Excelente! Artigo profundo, 'knowledge sharing' de alto nível, leitura obrigatória.

RESPONDA APENAS O NÚMERO, SEM TEXTO ADICIONAL.`,
} as const;
