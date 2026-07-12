import { inject, singleton } from "tsyringe";
import { CacheService } from "./cache.service";

/**
 * Serviço utilitário para extrair o texto principal de uma página web.
 * Faz um fetch simples e tenta extrair <title>, <meta description> e os principais <p> e <article>.
 * Limita o texto retornado para evitar prompts muito grandes.
 */
@singleton()
export class LinkScraperService {
  private readonly MAX_TEXT_LENGTH = 1200; // Limite de caracteres do texto extraído
  private readonly MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB safety cap
  private readonly MAX_REDIRECTS = 3;

  constructor(@inject(CacheService) private cacheService: CacheService) {}

  /**
   * Faz scraping simples do link e retorna um texto resumido do conteúdo principal.
   * @param url URL do blog/artigo
   * @returns Texto extraído (ou string vazia se falhar)
   */
  async extractMainText(url: string): Promise<string> {
    if (!this.isAllowedFetchUrl(url)) {
      return "";
    }

    const cacheKey = `scrape:${url}`;
    const cachedText = await this.cacheService.get<string>(cacheKey);
    if (cachedText) {
      return cachedText;
    }

    try {
      const response = await this.safeFetch(url, this.MAX_REDIRECTS);

      if (!response || !response.ok) {
        return "";
      }

      const html = await this.readBoundedText(
        response,
        this.MAX_RESPONSE_BYTES,
      );

      // Extrai <title>
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";

      // Extrai <meta name="description">
      const metaDescMatch = html.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^\"'>]+)["'][^>]*>/i
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

      if (context) {
        await this.cacheService.set(cacheKey, context);
      }

      return context;
    } catch (err) {
      // Falha silenciosa (não quebra o fluxo principal)
      return "";
    }
  }

  /**
   * Remove tags HTML e retorna apenas o texto limpo.
   */
  extractTextFromHTML(html: string): string {
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

  // Proteção SSRF: bloqueia protocolos inseguros e hosts que resolvem para
  // redes internas/privadas (inclui cloud metadata — 169.254/16, .internal).
  private isAllowedFetchUrl(rawUrl: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    return !this.isInternalHost(host);
  }

  private isInternalHost(host: string): boolean {
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal")
    ) {
      return true;
    }

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return this.isPrivateIPv4(host);
    }

    // IPv6 literals contêm ':' (hostnames normais nunca contêm).
    if (host.includes(":")) {
      return this.isPrivateIPv6(host);
    }
    return false;
  }

  private isPrivateIPv4(ipv4: string): boolean {
    const m = ipv4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (Number(m[3]) > 255 || Number(m[4]) > 255 || a > 255 || b > 255) {
      return false;
    }
    return (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10.0.0.0/8
      a === 127 || // 127.0.0.0/8 loopback
      (a === 169 && b === 254) || // 169.254.0.0/16 link-local (+ cloud metadata)
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 CGNAT
    );
  }

  private isPrivateIPv6(host: string): boolean {
    const clean = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (clean === "::1" || clean === "::") return true;

    // Inspeciona o primeiro hextet (considerando compressão "::").
    const first = clean.split("::")[0].split(":")[0];
    const n = first ? parseInt(first, 16) : 0;
    if (!Number.isNaN(n)) {
      if (n >= 0xfe80 && n <= 0xfebf) return true; // fe80::/10 link-local
      if (n >= 0xfc00 && n <= 0xfdff) return true; // fc00::/7 unique-local
    }

    // IPv4-mapped (::ffff:<ipv4>). O serializador da WHATWG reescreve
    // "::ffff:127.0.0.1" como "::ffff:7f00:1", então aceitamos as duas formas.
    return this.matchesPrivateIPv4Mapped(clean);
  }

  private matchesPrivateIPv4Mapped(clean: string): boolean {
    if (!clean.startsWith("::ffff:")) return false;
    const tail = clean.slice("::ffff:".length);

    const dq = tail.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (dq) return this.isPrivateIPv4(dq[1]);

    const hex = tail.match(/^(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const h1 = parseInt(hex[1], 16);
      const h2 = parseInt(hex[2], 16);
      const ip = `${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`;
      return this.isPrivateIPv4(ip);
    }
    return false;
  }

  private async safeFetch(
    url: string,
    redirectsLeft: number,
  ): Promise<Response | null> {
    if (!this.isAllowedFetchUrl(url)) {
      return null;
    }

    const response = await fetch(url, {
      headers: {
        // User-Agent customizado para evitar bloqueios simples
        "User-Agent": "Mozilla/5.0 (compatible; TechNewsBot/1.0)",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      redirect: "manual",
    });

    const status = response.status;
    if (status >= 300 && status < 400) {
      if (redirectsLeft <= 0) return null;
      const location = response.headers.get("location");
      if (!location) return null;
      try {
        const next = new URL(location, url).toString();
        return this.safeFetch(next, redirectsLeft - 1);
      } catch {
        return null;
      }
    }

    return response;
  }

  private async readBoundedText(
    response: Response,
    maxBytes: number,
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      return "";
    }

    const decoder = new TextDecoder("utf-8");
    let result = "";
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return result;
        }
        result += decoder.decode(value, { stream: true });
      }
    }

    result += decoder.decode();
    return result;
  }
}
