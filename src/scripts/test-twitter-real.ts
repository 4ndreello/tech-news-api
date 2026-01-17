import "reflect-metadata";
import { container } from "tsyringe";
import { TwitterService } from "../services/twitter.service";
import { DataWarehouseService } from "../services/data-warehouse.service";
import { LoggerService } from "../services/logger.service";

// Configuração básica de logger para ver no console
const logger = {
  info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta || ""),
  error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta || ""),
  warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta || ""),
  debug: (msg: string, meta?: any) => console.debug(`[DEBUG] ${msg}`, meta || ""),
};

// Registra logger simulado para ver output no terminal
container.registerInstance(LoggerService, logger as any);

async function run() {
  console.log("🚀 Iniciando Teste Real de Integração com Twitter...");
  
  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.error("❌ ERRO: TWITTER_BEARER_TOKEN não encontrado no .env");
    process.exit(1);
  }

  // Inicializa Warehouse (precisa de Mongo)
  const warehouse = container.resolve(DataWarehouseService);
  // Pequeno delay para garantir conexão mongo
  await new Promise(resolve => setTimeout(resolve, 1000));

  const twitterService = container.resolve(TwitterService);

  console.log("\n--- TENTATIVA 1: Busca Real ---");
  try {
    const items = await twitterService.fetchNews();
    console.log(`✅ Resultado: ${items.length} tweets recuperados.`);
    
    if (items.length > 0) {
      console.log("\nExemplo do primeiro tweet:");
      console.log("Autor:", items[0].author);
      console.log("Texto:", items[0].title);
      console.log("Data:", items[0].publishedAt);
    } else {
      console.log("⚠️ Nenhum tweet encontrado. Verifique se os usuários alvo postaram algo recente ou se o token está válido.");
    }
  } catch (error) {
    console.error("❌ Erro na busca:", error);
  }

  console.log("\n--- TENTATIVA 2: Teste de Bloqueio (Simulação Imediata) ---");
  console.log("Tentando buscar novamente imediatamente (deve ser bloqueado)...");
  
  try {
    // Como acabamos de buscar (ou tentar), o warehouse deve ter registrado (se salvamos)
    // Mas espere! O TwitterService consulta o Warehouse PARA LER a data, mas quem SALVA a data é o SmartMix/PersistenceService.
    // O TwitterService é apenas "Leitor".
    // Para este teste funcionar, precisamos SIMULAR que o dado foi salvo no Warehouse, 
    // já que este script roda isolado do fluxo normal de persistência.
    
    // Vamos salvar manualmente um registro "fake" no warehouse para testar a trava
    if (warehouse['rawCollection']) {
       await warehouse.saveRawNews([{ id: 'test-lock', source: 'Twitter' } as any], 'Twitter');
       console.log("(Simulei salvamento no banco para testar a trava)");
    }

    const items2 = await twitterService.fetchNews();
    // Se a trava funcionar, ele deve retornar o fallback (que pode ser o item que acabamos de salvar ou vazio)
    // Mas o importante é verificar o LOG. O script vai mostrar "[INFO] Twitter Safety Lock Active..."
    
    console.log(`✅ Resultado Tentativa 2: ${items2.length} itens (via fallback/cache).`);
  } catch (error) {
    console.error("❌ Erro na tentativa 2:", error);
  }

  console.log("\n🏁 Teste finalizado. Pressione Ctrl+C para sair se não fechar sozinho.");
  // Força desconexão para encerrar script limpo
  await warehouse.disconnect();
  process.exit(0);
}

run().catch(console.error);
