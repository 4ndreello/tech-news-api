import { inject, singleton } from "tsyringe";
import { GoogleGenAI } from "@google/genai";
import { LoggerService } from "./logger.service";
import { GeminiPrompts } from "../prompts/gemini-prompts";

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

  private async safeGenerateContent(prompt: string): Promise<string | null> {
    let delay = 500;
    const maxRetries = 3;
    const jitter = () => Math.random() * delay * 0.3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.geminiModel,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        return response.text ?? null;
      } catch (error) {
        const is429 =
          error instanceof Error && error.message.includes("429");
        if (!is429 || attempt >= maxRetries) {
          throw error;
        }
        await new Promise((r) => setTimeout(r, delay + jitter()));
        delay *= 2;
      }
    }
    return null;
  }

  /**
   * Generates a resume using IA
   * @param text Texto to resume
   * @param maxTokens Max tokens to resume
   * @returns IA resume
   */
  async summarize(text: string, maxTokens: number = 1024): Promise<string> {
    const prompt = GeminiPrompts.summarize(text);

    const result = await this.safeGenerateContent(prompt);

    if (!result) {
      this.logger.error(
        "Empty response or unexpected response from Gemini API.",
        {
          responseText: result,
        },
      );
      throw new Error("Empty response or unexpected response from Gemini API.");
    }

    return result.trim().slice(0, maxTokens);
  }

  /**
   * Analyzes if content is technology-related
   * @param title Post title
   * @param body Post body content (Markdown)
   * @returns Score from 0-100 (100 = definitely tech-related)
   */
  async analyzeTechRelevance(title: string, body: string): Promise<number> {
    const prompt = GeminiPrompts.analyzeTechRelevance(title, body);

    try {
      const result = await this.safeGenerateContent(prompt);

      if (!result) {
        this.logger.warn(
          "Empty response from Gemini tech analysis, defaulting to 0",
        );
        return 0;
      }

      const score = Number.parseInt(result.trim(), 10);

      if (Number.isNaN(score) || score < 0 || score > 100) {
        this.logger.warn("Invalid score from Gemini, defaulting to 0", {
          responseText: result,
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
