import type { ServiceStatus, ServicesStatusResponse } from "../types";
import { ServiceStatusType } from "../types";
import { logger } from "../logger";

// Cache configuration
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const REQUEST_TIMEOUT = 8000; // 8 seconds
const BACKGROUND_UPDATE_INTERVAL = 3 * 60 * 1000; // 3 minutes

let cachedStatus: ServicesStatusResponse | null = null;
let lastFetch = 0;
let backgroundTaskId: Timer | null = null;

/**
 * Faz uma requisição HTTP com timeout
 */
async function fetchWithTimeout(
  url: string,
  timeout = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TechNews-StatusChecker/1.0",
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Verifica o status do GitHub usando sua API oficial
 */
async function checkGitHub(): Promise<ServiceStatusType> {
  try {
    const response = await fetchWithTimeout(
      "https://www.githubstatus.com/api/v2/status.json"
    );
    if (!response.ok) return ServiceStatusType.Degraded;

    const data = (await response.json()) as {
      status: { indicator: string };
    };
    const indicator = data.status.indicator;

    // Treat "none" and "minor" as operational (minor incidents are usually small)
    if (indicator === "none" || indicator === "minor")
      return ServiceStatusType.Operational;
    // "major" is degraded, "critical" is down
    if (indicator === "major") return ServiceStatusType.Degraded;
    return ServiceStatusType.Down;
  } catch (error) {
    logger.warn("github status check failed", { error: String(error) });
    return ServiceStatusType.Down;
  }
}

/**
 * Verifica o status do Cloudflare
 */
async function checkCloudflare(): Promise<ServiceStatusType> {
  try {
    const response = await fetchWithTimeout(
      "https://www.cloudflarestatus.com/api/v2/status.json"
    );
    if (!response.ok) return ServiceStatusType.Degraded;

    const data = (await response.json()) as {
      status: { indicator: string };
    };
    const indicator = data.status.indicator;

    // Treat "none" and "minor" as operational (minor incidents are usually small)
    if (indicator === "none" || indicator === "minor")
      return ServiceStatusType.Operational;
    // "major" is degraded, "critical" is down
    if (indicator === "major") return ServiceStatusType.Degraded;
    return ServiceStatusType.Down;
  } catch (error) {
    logger.warn("cloudflare status check failed", { error: String(error) });
    return ServiceStatusType.Down;
  }
}

/**
 * Verifica o status do Vercel
 */
async function checkVercel(): Promise<ServiceStatusType> {
  try {
    const response = await fetchWithTimeout(
      "https://www.vercel-status.com/api/v2/status.json"
    );
    if (!response.ok) return ServiceStatusType.Degraded;

    const data = (await response.json()) as {
      status: { indicator: string };
    };
    const indicator = data.status.indicator;

    // Treat "none" and "minor" as operational (minor incidents are usually small)
    if (indicator === "none" || indicator === "minor")
      return ServiceStatusType.Operational;
    // "major" is degraded, "critical" is down
    if (indicator === "major") return ServiceStatusType.Degraded;
    return ServiceStatusType.Down;
  } catch (error) {
    logger.warn("vercel status check failed", { error: String(error) });
    return ServiceStatusType.Down;
  }
}

/**
 * Verifica o status de um serviço fazendo ping simples
 */
async function checkServiceByPing(
  url: string,
  serviceName: string
): Promise<ServiceStatusType> {
  try {
    const response = await fetchWithTimeout(url);
    if (response.ok) return ServiceStatusType.Operational;
    if (response.status >= 500) return ServiceStatusType.Down;
    return ServiceStatusType.Degraded;
  } catch (error) {
    logger.warn(`${serviceName} ping check failed`, {
      error: String(error),
    });
    return ServiceStatusType.Down;
  }
}

/**
 * Busca o status de todos os serviços
 */
async function fetchServiceStatuses(): Promise<ServicesStatusResponse> {
  logger.info("fetching service statuses...");

  const timestamp = new Date().toISOString();

  // Executa todas as verificações em paralelo
  const [githubStatus, cloudflareStatus, vercelStatus, awsStatus, gcpStatus] =
    await Promise.all([
      checkGitHub(),
      checkCloudflare(),
      checkVercel(),
      checkServiceByPing("https://aws.amazon.com", "AWS"),
      checkServiceByPing("https://cloud.google.com", "GCP"),
    ]);

  const services: ServiceStatus[] = [
    {
      name: "AWS",
      status: awsStatus,
      lastChecked: timestamp,
      url: "https://health.aws.amazon.com/health/status",
    },
    {
      name: "GCP",
      status: gcpStatus,
      lastChecked: timestamp,
      url: "https://status.cloud.google.com/",
    },
    {
      name: "Cloudflare",
      status: cloudflareStatus,
      lastChecked: timestamp,
      url: "https://www.cloudflarestatus.com/",
    },
    {
      name: "GitHub",
      status: githubStatus,
      lastChecked: timestamp,
      url: "https://www.githubstatus.com/",
    },
    {
      name: "Vercel",
      status: vercelStatus,
      lastChecked: timestamp,
      url: "https://www.vercel-status.com/",
    },
  ];

  logger.info("service statuses fetched successfully", {
    operational: services.filter((s) => s.status === "operational").length,
    degraded: services.filter((s) => s.status === "degraded").length,
    down: services.filter((s) => s.status === "down").length,
  });

  return {
    services,
    lastUpdate: timestamp,
  };
}

/**
 * Atualiza o cache de status (usado pelo background task)
 */
async function updateCache(): Promise<void> {
  try {
    cachedStatus = await fetchServiceStatuses();
    lastFetch = Date.now();
  } catch (error) {
    logger.error("failed to update service status cache", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

/**
 * Inicia a tarefa em background para atualizar o cache periodicamente
 */
export function startBackgroundUpdates(): void {
  if (backgroundTaskId) {
    logger.warn("background update task already running");
    return;
  }

  logger.info("starting service status background updates", {
    interval: `${BACKGROUND_UPDATE_INTERVAL / 1000}s`,
  });

  // Atualiza imediatamente
  updateCache();

  // Agenda atualizações periódicas
  backgroundTaskId = setInterval(() => {
    updateCache();
  }, BACKGROUND_UPDATE_INTERVAL);
}

/**
 * Para a tarefa em background
 */
export function stopBackgroundUpdates(): void {
  if (backgroundTaskId) {
    clearInterval(backgroundTaskId);
    backgroundTaskId = null;
    logger.info("stopped service status background updates");
  }
}

/**
 * Obtém o status dos serviços (retorna cache se válido ou busca novos dados)
 */
export async function getServicesStatus(): Promise<ServicesStatusResponse> {
  const now = Date.now();

  // Retorna cache se válido
  if (cachedStatus && now - lastFetch < CACHE_TTL) {
    logger.info("returning cached service status", {
      age: `${Math.round((now - lastFetch) / 1000)}s`,
    });
    return cachedStatus;
  }

  // Cache inválido ou não existe, busca novos dados
  logger.info("cache expired or missing, fetching fresh service status");

  try {
    cachedStatus = await fetchServiceStatuses();
    lastFetch = now;
    return cachedStatus;
  } catch (error) {
    // Se falhar e houver cache antigo, retorna ele
    if (cachedStatus) {
      logger.warn("failed to fetch new status, returning stale cache", {
        age: `${Math.round((now - lastFetch) / 1000)}s`,
      });
      return cachedStatus;
    }

    // Sem cache, propaga o erro
    throw error;
  }
}
