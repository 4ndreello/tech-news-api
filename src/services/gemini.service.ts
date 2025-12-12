import { singleton } from "tsyringe";
import { GoogleGenAI } from "@google/genai";

@singleton()
export class GeminiService {
  private readonly ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não definida no ambiente");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Gera um resumo curto e objetivo do texto usando Gemini 1.5 Flash.
   * @param text Texto a ser resumido
   * @param maxTokens Máximo de tokens no resumo (opcional, padrão: 120)
   * @returns Resumo IA gerado
   */
  async summarize(text: string, maxTokens = 300): Promise<string> {
    const prompt = `Resuma o texto abaixo em um parágrafo claro, objetivo e SEM ENROLAÇÃO, em português do Brasil. Não repita o título. Foque no conteúdo relevante para tecnologia e desenvolvimento. Use até 8 frases.\n\n${text}`;
    const model = "gemini-2.0-flash-lite";

    const response = await this.ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    // O response.text já traz o resumo limpo
    if (!response.text) {
      throw new Error("Resumo IA vazio ou resposta inesperada da Gemini API.");
    }
    // Limita o tamanho do resumo para evitar respostas muito longas (~300 tokens)
    return response.text.trim().slice(0, 1800);
  }
}
