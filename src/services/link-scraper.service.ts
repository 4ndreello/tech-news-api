import { singleton } from "tsyringe";

/**
 * Serviço utilitário para extrair o texto principal de uma página web.
 * Faz um fetch simples e tenta extrair <title>, <meta description> e os principais <p> e <article>.
 * Limita o texto retornado para evitar prompts muito grandes.
 */
@singleton()
export class LinkScraperService {
  private readonly MAX_TEXT_LENGTH = 1200; // Limite de caracteres do texto extraído

  /**
   * Faz scraping simples do link e retorna um texto resumido do conteúdo principal.
   * @param url URL do blog/artigo
   * @returns Texto extraído (ou string vazia se falhar)
   */
  async extractMainText(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          // User-Agent customizado para evitar bloqueios simples
          "User-Agent": "Mozilla/5.0 (compatible; TechNewsBot/1.0)",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        return "";
      }

      const html = await response.text();

      // Extrai <title>
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";

      // Extrai <meta name="description">
      const metaDescMatch = html.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^\"'>]+)["'][^>]*>/i,
      );
      const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : "";

      // Extrai <article> (se existir)
      let articleText = "";
      const articleMatch = html.match(/<article[^>]*>([\s\S]+?)<\/article>/i);
      if (articleMatch) {
        articleText = this.extractTextFromHTML(articleMatch[1]);
      }

      // Extrai os primeiros <p> (caso não tenha <article>)
      let pText = "";
      if (!articleText) {
        // Pega até 5 parágrafos
        const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
        pText = pMatches
          .slice(0, 5)
          .map((m) => this.extractTextFromHTML(m[1]))
          .join("\n");
      }

      // Monta o contexto final
      let context = "";
      if (title) context += `Título do artigo: ${title}\n`;
      if (metaDesc) context += `Descrição: ${metaDesc}\n`;
      if (articleText) context += `${articleText}\n`;
      else if (pText) context += `${pText}\n`;

      // Limita o tamanho do texto
      if (context.length > this.MAX_TEXT_LENGTH) {
        context = context.slice(0, this.MAX_TEXT_LENGTH) + "...";
      }

      // Remove excesso de espaços
      context = context.replace(/\s{3,}/g, " ").trim();

      return context;
    } catch (err) {
      // Falha silenciosa (não quebra o fluxo principal)
      return "";
    }
  }

  /**
   * Remove tags HTML e retorna apenas o texto limpo.
   */
  private extractTextFromHTML(html: string): string {
    // Remove scripts/styles
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
    // Remove todas as tags HTML
    text = text.replace(/<[^>]+>/g, "");
    // Decodifica entidades HTML básicas
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    // Remove múltiplos espaços e linhas
    text = text.replace(/\s{2,}/g, " ");
    text = text.replace(/\n{2,}/g, "\n");
    return text.trim();
  }
}
