# Melhorias no Algoritmo de Ranking

## Objetivo
Melhorar o algoritmo para favorecer conteúdo de **1-5 dias**, reduzindo o peso de posts muito recentes (<12h).

## Mudanças Implementadas

### Algoritmo Anterior
```typescript
const gravity = 1.4;
const weightedScore = points + (comments * 0.5);
return (weightedScore + 1) / Math.pow(ageInHours + 2, gravity);
```

### Novo Algoritmo
```typescript
// Adiciona freshnessFactor que varia com a idade:
// - < 12h: 0.6x (penaliza muito recente)
// - 12h-24h: 0.85x
// - 1-5 dias: 1.0x - 1.5x (BOOST!)
// - 5-10 dias: 1.0x - 0.5x (declínio gradual)
// - > 10 dias: declínio rápido

const gravity = 1.2; // reduzido de 1.4
return ((weightedScore + 1) * freshnessFactor) / timePenalty;
```

## Resultados dos Testes

### Mudanças de Ranking (% de variação)

| Idade | Descrição | Mudança |
|-------|-----------|---------|
| 1 dia | Alto engagement | +187.8% ⬆️ |
| 2 dias | Alto engagement (SWEET SPOT) | +185.0% ⬆️ |
| 3 dias | Alto engagement (SWEET SPOT) | +180.0% ⬆️ |
| 5 dias | Alto engagement | +179.1% ⬆️ |
| 7 dias | Alto engagement | +123.4% ⬆️ |
| 1h | Alto engagement | -25.3% ⬇️ |
| 6h | Alto engagement | -9.1% ⬇️ |
| 14 dias | Alto engagement | -55.8% ⬇️ |

### Novo Ranking (Top 5)

**Antes:**
1. Post de 1h atrás (alto engagement) - Rank: 23.84
2. Post de 1h atrás (baixo engagement) - Rank: 11.49
3. Post de 30min atrás (poucos pontos) - Rank: 8.87
4. Post de 6h atrás (alto engagement) - Rank: 6.04
5. Post de 12h atrás (alto engagement) - Rank: 2.76

**Depois:**
1. Post de 1h atrás (alto engagement) - Rank: 17.82
2. Post de 1h atrás (baixo engagement) - Rank: 8.59
3. **Post VIRAL de 1 dia** - Rank: 6.80 ⭐
4. Post de 30min atrás (poucos pontos) - Rank: 6.39
5. Post de 6h atrás (alto engagement) - Rank: 5.49

### Principais Benefícios

✅ **Conteúdo de 1-5 dias é MUITO mais valorizado** (~3x boost)
✅ **Posts virais de 1-3 dias agora competem com posts muito recentes**
✅ **Posts muito recentes precisam provar seu valor** (penalidade de 25-40%)
✅ **Conteúdo antigo (>2 semanas) é menos relevante** (-55%)

## Como Funciona o FreshnessFactor

```
1.5x |     ╱‾‾‾╲
     |    ╱     ╲___
1.0x |___╱          ╲___
     |                  ╲___
0.5x |______________________╲___
     0h  12h  1d   3d   5d   7d   10d   14d

         PENALIZA  |  SWEET SPOT  |  DECLÍNIO
```

- **< 12h**: Penaliza (0.6x) - conteúdo muito novo
- **12-24h**: Moderado (0.85x) - ainda em avaliação
- **1-5 dias**: BOOST (1.0-1.5x) - zona ideal
- **5-10 dias**: Declínio gradual
- **> 10 dias**: Declínio rápido
