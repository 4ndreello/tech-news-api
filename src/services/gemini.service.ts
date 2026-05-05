import { inject, singleton } from "tsyringe";
import { GoogleGenAI } from "@google/genai";
import { LoggerService } from "./logger.service";
import { GeminiPrompts } from "../prompts/gemini-prompts";
import { RateLimiter } from "../utils/rate-limiter";

const GEMINI_MAX_CONCURRENCY = Number(process.env.GEMINI_MAX_CONCURRENCY) || 3;

@singleton()
export class GeminiService {
  private readonly ai: GoogleGenAI;
  private readonly geminiModel = "gemini-2.0-flash-lite";
  private readonly rateLimiter = new RateLimiter(GEMINI_MAX_CONCURRENCY);

  constructor(@inject(LoggerService) private logger: LoggerService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não definida no ambiente");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof Error && "status" in error) {
      const status = (error as { status: number }).status;
      if (status === 429 || (status >= 500 && status < 600)) {
        return true;
      }
    }
    if (
      error instanceof Error &&
      (error.constructor.name === "APIConnectionError" ||
        error.constructor.name === "APIConnectionTimeoutError")
    ) {
      return true;
    }
    return false;
  }

  private async safeGenerateContent(prompt: string): Promise<string | null> {
    let delay = 500;
    const maxRetries = 3;
    const jitter = () => Math.random() * delay * 0.3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.rateLimiter.run(() =>
          this.ai.models.generateContent({
            model: this.geminiModel,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          }),
        );
        return response.text ?? null;
      } catch (error) {
        if (!this.isTransientError(error) || attempt >= maxRetries) {
          throw error;
        }
        this.logger.warn("Gemini API transient error, retrying", {
          attempt: attempt + 1,
          error,
        });
        await new Promise((r) => setTimeout(r, delay + jitter()));
        delay *= 2;
      }
    }
    return null;
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
      return 0;
    }
  }
}
