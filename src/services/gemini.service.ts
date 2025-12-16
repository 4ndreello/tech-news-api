import { inject, singleton } from "tsyringe";
import { GoogleGenAI } from "@google/genai";
import { LoggerService } from "./logger.service";

@singleton()
export class GeminiService {
  private readonly ai: GoogleGenAI;
  private readonly geminiModel = "gemini-2.0-flash-lite";

  constructor(@inject(LoggerService) private logger: LoggerService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não definida no ambiente");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Generates a resume using IA
   * @param text Texto to resume
   * @param maxTokens Max tokens to resume
   * @returns IA resume
   */
  async summarize(text: string, maxTokens: number = 1024): Promise<string> {
    const prompt = `Resuma o texto abaixo em um parágrafo claro, objetivo e SEM ENROLAÇÃO, em português do Brasil. Não repita o título. Foque no conteúdo relevante para tecnologia e desenvolvimento. Use até 14 frases.\n\n${text}`;

    const response = await this.ai.models.generateContent({
      model: this.geminiModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    if (!response.text) {
      this.logger.error(
        "Empty response or unexpected response from Gemini API.",
        {
          responseText: response.text,
        },
      );
      throw new Error("Empty response or unexpected response from Gemini API.");
    }

    return response.text.trim().slice(0, maxTokens);
  }

  /**
   * Analyzes if content is technology-related
   * @param title Post title
   * @param body Post body content (Markdown)
   * @returns Score from 0-100 (100 = definitely tech-related)
   */
  async analyzeTechRelevance(title: string, body: string): Promise<number> {
    const prompt = `Analise se o conteúdo abaixo é relacionado a TECNOLOGIA (programação, desenvolvimento, software, hardware, IA, cloud, DevOps, engenharia de software, ciência da computação, segurança digital, etc).

TÍTULO: ${title}

CONTEÚDO: ${body.slice(0, 2000)}

Responda APENAS com um número de 0 a 100:
- 0-30: Não é sobre tecnologia (política, economia, investimentos, notícias gerais)
- 31-60: Parcialmente relacionado (menção superficial a tech)
- 61-100: Claramente sobre tecnologia (conteúdo técnico, tutoriais, discussões de dev)

RESPONDA APENAS O NÚMERO, SEM TEXTO ADICIONAL.`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.geminiModel,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      if (!response.text) {
        this.logger.warn(
          "Empty response from Gemini tech analysis, defaulting to 0",
        );
        return 0;
      }

      const score = Number.parseInt(response.text.trim(), 10);

      if (Number.isNaN(score) || score < 0 || score > 100) {
        this.logger.warn("Invalid score from Gemini, defaulting to 0", {
          responseText: response.text,
        });
        return 0;
      }

      return score;
    } catch (error) {
      this.logger.error("Error analyzing tech relevance", { error });
      return 0; // On error, assume not tech-related (safe default)
    }
  }
}
