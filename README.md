# TechNews API

Backend API para o agregador TechNews, construído com **Hono** + **Bun**.

Este servidor expõe endpoints REST que agregam notícias de tecnologia do **TabNews** e **Hacker News**, aplicando um algoritmo inteligente de ranking baseado em pontos, comentários e tempo de publicação.

## 🚀 Tecnologias

- **Bun** - Runtime JavaScript ultrarrápido
- **Hono** - Framework web minimalista e performático
- **TypeScript** - Tipagem estática

## 📋 Funcionalidades

- ✅ Busca de notícias do TabNews
- ✅ Busca de notícias do Hacker News
- ✅ Smart Mix - Intercalação inteligente de ambas as fontes
- ✅ Sistema de cache (5 minutos)
- ✅ Algoritmo de ranking customizado
- ✅ Busca de comentários de posts do TabNews
- ✅ CORS configurado para frontend
- ✅ Tratamento robusto de erros

## 🧮 Algoritmo de Ranking

```
Rank = (Points + (Comments × 0.5) + 1) / (T + 2)^G
```

Onde:
- **Points**: Pontos/coins/upvotes do post
- **Comments**: Número de comentários (peso 0.5)
- **T**: Idade do post em horas
- **G**: Gravidade = 1.4 (fator de degradação temporal)

Este algoritmo prioriza conteúdo recente com alto engajamento, mas ainda dá espaço para posts mais antigos com muita relevância.

## 📦 Instalação

### Pré-requisitos

- [Bun](https://bun.sh/) instalado (versão 1.0+)

### Passos

```bash
# Clone ou navegue até o diretório
cd tech-news-api

# Instale as dependências
bun install

# (Opcional) Configure variáveis de ambiente
cp .env.example .env
```

## 🏃 Executando o Servidor

### Modo Desenvolvimento (com hot reload)

```bash
bun run dev
```

### Modo Produção

```bash
bun start
```

O servidor estará disponível em: **http://localhost:3001**

## 📚 Endpoints da API

### Root - Informações da API

```http
GET /
```

**Resposta:**
```json
{
  "message": "TechNews API - Powered by Hono + Bun",
  "version": "1.0.0",
  "endpoints": {
    "tabnews": "/api/news/tabnews",
    "hackernews": "/api/news/hackernews",
    "mix": "/api/news/mix",
    "comments": "/api/comments/:username/:slug"
  }
}
```

---

### TabNews - Buscar notícias do TabNews

```http
GET /api/news/tabnews
```

**Resposta:**
```json
{
  "success": true,
  "data": [
    {
      "id": "abc123",
      "title": "Como construir uma API com Bun",
      "author": "usuario",
      "score": 42,
      "publishedAt": "2025-12-11T10:30:00.000Z",
      "source": "TabNews",
      "slug": "como-construir-uma-api-com-bun",
      "owner_username": "usuario",
      "body": "# Conteúdo do post...",
      "sourceUrl": null,
      "commentCount": 15
    }
  ],
  "count": 30
}
```

---

### Hacker News - Buscar notícias do Hacker News

```http
GET /api/news/hackernews
```

**Resposta:**
```json
{
  "success": true,
  "data": [
    {
      "id": "38589210",
      "title": "Show HN: My new project",
      "author": "username",
      "score": 250,
      "publishedAt": "2025-12-11T12:00:00.000Z",
      "source": "HackerNews",
      "url": "https://example.com",
      "commentCount": 89
    }
  ],
  "count": 30
}
```

---

### Smart Mix - Intercalação inteligente

```http
GET /api/news/mix
```

Retorna até 40 notícias (20 de cada fonte), ranqueadas e intercaladas para máxima diversidade.

**Resposta:**
```json
{
  "success": true,
  "data": [
    { "source": "TabNews", ... },
    { "source": "HackerNews", ... },
    { "source": "TabNews", ... },
    { "source": "HackerNews", ... }
  ],
  "count": 40
}
```

---

### Comentários - Buscar comentários de um post do TabNews

```http
GET /api/comments/:username/:slug
```

**Parâmetros:**
- `username`: Nome do usuário autor do post
- `slug`: Slug do post

**Exemplo:**
```http
GET /api/comments/filipedeschamps/meu-post-incrivel
```

**Resposta:**
```json
{
  "success": true,
  "data": [
    {
      "id": "comment-1",
      "parent_id": null,
      "owner_username": "usuario",
      "body": "Ótimo post!",
      "created_at": "2025-12-11T13:00:00.000Z",
      "children": [],
      "tabcoins": 5
    }
  ],
  "count": 10
}
```

---

## 🔄 Integração com Frontend

Para integrar este backend com o frontend React existente em `../tech-news`, você precisa atualizar o arquivo `services/api.ts`:

### Exemplo de integração

```typescript
// services/api.ts (Frontend)

const API_BASE_URL = 'http://localhost:3001/api';

export const fetchTabNews = async (): Promise<NewsItem[]> => {
  const res = await fetch(`${API_BASE_URL}/news/tabnews`);
  if (!res.ok) throw new Error('Falha ao carregar TabNews');
  const data = await res.json();
  return data.data;
};

export const fetchHackerNews = async (): Promise<NewsItem[]> => {
  const res = await fetch(`${API_BASE_URL}/news/hackernews`);
  if (!res.ok) throw new Error('Falha ao carregar Hacker News');
  const data = await res.json();
  return data.data;
};

export const fetchSmartMix = async (): Promise<NewsItem[]> => {
  const res = await fetch(`${API_BASE_URL}/news/mix`);
  if (!res.ok) throw new Error('Falha ao carregar notícias');
  const data = await res.json();
  return data.data;
};

export const fetchTabNewsComments = async (username: string, slug: string): Promise<Comment[]> => {
  const res = await fetch(`${API_BASE_URL}/comments/${username}/${slug}`);
  if (!res.ok) throw new Error('Falha ao carregar comentários');
  const data = await res.json();
  return data.data;
};
```

## ⚙️ Configuração de CORS

O servidor já está configurado para aceitar requisições das seguintes origens:

- `http://localhost:3000`
- `http://0.0.0.0:3000`

Para adicionar mais origens, edite o arquivo `src/index.ts`:

```typescript
app.use('/*', cors({
  origin: ['http://localhost:3000', 'https://seu-dominio.com'],
  credentials: true,
}));
```

## 🧪 Testando a API

### Usando curl

```bash
# Testar endpoint root
curl http://localhost:3001/

# Buscar TabNews
curl http://localhost:3001/api/news/tabnews

# Buscar Hacker News
curl http://localhost:3001/api/news/hackernews

# Buscar Smart Mix
curl http://localhost:3001/api/news/mix

# Buscar comentários
curl http://localhost:3001/api/comments/filipedeschamps/meu-post
```

### Usando navegador

Acesse diretamente:
- http://localhost:3001/
- http://localhost:3001/api/news/mix

## 📊 Cache

O servidor implementa um sistema de cache em memória:

- **Duração**: 5 minutos
- **Limpeza**: Automática ao expirar
- **Benefícios**: Reduz chamadas às APIs externas e melhora performance

## 🐛 Tratamento de Erros

Todos os endpoints retornam respostas padronizadas em caso de erro:

```json
{
  "success": false,
  "error": "Mensagem de erro descritiva"
}
```

Status HTTP apropriados são usados:
- `400` - Bad Request (parâmetros inválidos)
- `404` - Not Found (endpoint não existe)
- `500` - Internal Server Error (erro no servidor ou APIs externas)

## 🚀 Deploy

### Deploy no Bun.sh (Recomendado)

```bash
bun build src/index.ts --outdir ./dist --target bun
```

### Docker (Opcional)

Crie um `Dockerfile`:

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3001

CMD ["bun", "start"]
```

Build e execute:

```bash
docker build -t tech-news-api .
docker run -p 3001:3001 tech-news-api
```

## 📝 Estrutura do Projeto

```
tech-news-api/
├── src/
│   ├── index.ts      # Servidor Hono e rotas
│   ├── service.ts    # Lógica de negócio e fetching
│   └── types.ts      # Interfaces TypeScript
├── package.json      # Dependências e scripts
├── tsconfig.json     # Configuração TypeScript
├── .gitignore        # Arquivos ignorados pelo Git
├── .env.example      # Exemplo de variáveis de ambiente
└── README.md         # Documentação
```

## 🤝 Contribuindo

Sinta-se livre para abrir issues ou pull requests!

## 📄 Licença

MIT

---

Feito com ❤️ usando Bun + Hono
