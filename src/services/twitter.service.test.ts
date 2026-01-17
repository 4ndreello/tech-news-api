import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TwitterService } from "./twitter.service";
import { Source } from "../types";

// Mock das dependências
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

const mockWarehouse = {
  getLastFetchTime: vi.fn(),
  getRawNewsBySourceAndDate: vi.fn().mockResolvedValue([]),
};

// Mock da biblioteca twitter-api-v2
const mockSearch = vi.fn();
vi.mock("twitter-api-v2", () => {
  return {
    TwitterApi: vi.fn().mockImplementation(() => ({
      v2: {
        search: mockSearch,
      },
    })),
  };
});

describe("TwitterService - Safety Lock & Quota Protection", () => {
  let service: TwitterService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWITTER_BEARER_TOKEN = "fake-token";
    
    // Instancia o serviço com os mocks
    service = new TwitterService(
      mockLogger as any,
      mockWarehouse as any
    );
  });

  it("DEVE bloquear chamada (Safety Lock) se última busca foi há menos de 8 horas", async () => {
    // Cenário: Última busca foi há 1 hora
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    mockWarehouse.getLastFetchTime.mockResolvedValue(oneHourAgo);

    // Executa
    await service.fetchNews();

    // Verificações
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Safety Lock Active"));
    expect(mockSearch).not.toHaveBeenCalled(); // CRÍTICO: Não pode chamar a API
    expect(mockWarehouse.getRawNewsBySourceAndDate).toHaveBeenCalled(); // Deve buscar fallback
  });

  it("DEVE permitir chamada se última busca foi há mais de 8 horas", async () => {
    // Cenário: Última busca foi há 9 horas
    const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000);
    mockWarehouse.getLastFetchTime.mockResolvedValue(nineHoursAgo);
    
    // Mock resposta do Twitter
    mockSearch.mockResolvedValue({
      includes: { users: [] },
      [Symbol.asyncIterator]: async function* () { yield* []; }
    });

    // Executa
    await service.fetchNews();

    // Verificações
    expect(mockSearch).toHaveBeenCalled(); // Deve chamar a API
    // Verifica se algum dos calls contém a mensagem esperada
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Executing Twitter Sniper Fetch"),
      expect.anything() // Aceita o objeto de metadata extra
    );
  });

  it("DEVE permitir chamada se nunca houve busca anterior (primeira execução)", async () => {
    // Cenário: Nunca buscou (retorna null)
    mockWarehouse.getLastFetchTime.mockResolvedValue(null);
    
    // Mock resposta do Twitter
    mockSearch.mockResolvedValue({
      includes: { users: [] },
      [Symbol.asyncIterator]: async function* () { yield* []; }
    });

    // Executa
    await service.fetchNews();

    // Verificações
    expect(mockSearch).toHaveBeenCalled();
  });
});
