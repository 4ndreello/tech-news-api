# Sistema de Logging

Sistema de logging estruturado com Pino, compatível com Google Cloud Platform (GCP).

## Características

- ✅ **Logs estruturados** em JSON para produção
- ✅ **Logs formatados** com pino-pretty para desenvolvimento
- ✅ **Correlation ID** em todas as requisições para rastreabilidade
- ✅ **Compatível com GCP Cloud Logging** (severity, message format)
- ✅ **Contexto automático** em todos os logs (HttpRequest, Application, etc)

## Ambientes

### Desenvolvimento (default)
```bash
NODE_ENV=dev bun run dev
```

Logs coloridos e legíveis:
```
[11/12/2025 13:23:06] INFO: [abc-123] [HttpRequest] INCOMING REQUEST GET /api/news/mix
[11/12/2025 13:23:07] INFO: [abc-123] [HttpRequest] OUTGOING RESPONSE 200 - 1234ms
```

### Produção
```bash
NODE_ENV=prod bun start
# ou
NODE_ENV=production bun start
```

Logs JSON estruturados para GCP:
```json
{"severity":"INFO","correlationId":"abc-123","context":"HttpRequest","message":"INCOMING REQUEST GET /api/news/mix","httpRequest":{"requestMethod":"GET","requestUrl":"/api/news/mix"}}
{"severity":"INFO","correlationId":"abc-123","context":"HttpRequest","message":"OUTGOING RESPONSE 200 - 1234ms","httpResponse":{"status":200,"durationMs":1234}}
```

## Uso

### No middleware (automático)
O middleware adiciona automaticamente o logger ao contexto de cada requisição:

```typescript
app.get("/api/example", async (c) => {
  const logger = c.get('logger'); // Logger com correlation ID
  
  logger.info("Processando requisição");
  logger.warn("Atenção: cache expirado");
  logger.error("Erro ao processar", { 
    error: "message",
    stack: "..." 
  });
  
  return c.json({ ok: true });
});
```

### Logger global (sem correlation ID)
Para logs fora do contexto de requisições HTTP:

```typescript
import { logger } from './logger';

logger.info("Servidor iniciado", { port: 8080 });
logger.warn("Configuração padrão sendo usada");
logger.error("Falha crítica", { error: err.message });
```

### Criar logger customizado
```typescript
import { createLogger } from './logger';

const customLogger = createLogger({ 
  correlationId: 'batch-job-123' 
});

customLogger.info("Processando batch");
```

## Correlation ID

Cada requisição recebe um **Correlation ID único** (UUID v4):

- Gerado automaticamente se não fornecido
- Aceito via header `X-Correlation-Id` (para chamadas encadeadas)
- Retornado no header `X-Correlation-Id` da resposta
- Incluído em todos os logs da requisição

### Exemplo de rastreamento
```bash
# Cliente envia correlation ID
curl -H "X-Correlation-Id: my-trace-123" http://localhost:8080/api/news/mix

# Todos os logs da requisição incluem: [my-trace-123]
# Response retorna o mesmo ID no header
```

## Estrutura dos Logs

### Development (pino-pretty)
```
[DD/MM/YYYY HH:MM:SS] LEVEL: [correlation-id] [context] message
```

### Production (JSON para GCP)
```json
{
  "severity": "INFO|WARNING|ERROR|DEBUG|CRITICAL",
  "correlationId": "uuid-v4",
  "context": "Application|HttpRequest",
  "message": "log message",
  "httpRequest": { ... },      // Logs HTTP
  "httpResponse": { ... },     // Logs HTTP
  "error": "...",              // Logs de erro
  "stack": "..."               // Stack trace
}
```

## Campos GCP

O logger em produção usa campos compatíveis com GCP Cloud Logging:

- `severity`: INFO, WARNING, ERROR, DEBUG, CRITICAL
- `message`: Mensagem principal do log
- `httpRequest`: Metadados da requisição HTTP
- `httpResponse`: Metadados da resposta HTTP
- Sem `timestamp` (GCP adiciona automaticamente)

## Exemplos de Logs

### Startup
```typescript
logger.info(`🚀 TechNews API rodando em http://localhost:${port}`);
```

### Requisição HTTP
```typescript
// Automaticamente pelo middleware
[correlation-id] [HttpRequest] INCOMING REQUEST GET /api/news/mix
[correlation-id] [HttpRequest] OUTGOING RESPONSE 200 - 1234ms
```

### Erros
```typescript
logger.error("Error fetching TabNews", {
  error: err.message,
  stack: err.stack,
});
```

### Informações customizadas
```typescript
logger.info("Cache hit", {
  key: "tabnews",
  ttl: 300,
  size: 1234
});
```

## Ignorar arquivos estáticos

O middleware **não loga** requisições para arquivos estáticos (`.js`, `.css`, `.png`, etc).

## Troubleshooting

### Logs não aparecem em desenvolvimento
- Verifique se `NODE_ENV` não está setado como `prod` ou `production`
- Confirme que `pino-pretty` está instalado: `bun add pino-pretty`

### Formato errado no GCP
- Verifique se `NODE_ENV=prod` ou `NODE_ENV=production`
- Logs devem ser JSON válido, sem cores

### Correlation ID não aparece
- Verifique se o middleware está sendo aplicado: `app.use("/*", loggingMiddleware);`
- O middleware deve ser o primeiro (antes do CORS)
