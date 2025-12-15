import { inject, singleton } from "tsyringe";
import { GoogleGenAI } from "@google/genai";
import { LoggerService } from "./logger.service";

@singleton()
export class GeminiService {
  private readonly ai: GoogleGenAI;

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
    const model = "gemini-2.0-flash-lite";

    const response = await this.ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    if (!response.text) {
      this.logger.error(
        "Empty response or unexpected response from Gemini API.",
        {
          responseText: response.text,
        }
      );
      throw new Error("Empty response or unexpected response from Gemini API.");
    }

    return response.text.trim().slice(0, maxTokens);
  }
}
