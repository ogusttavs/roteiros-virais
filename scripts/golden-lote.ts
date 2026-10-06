/**
 * O golden set pelo lote (item pequeno do `PROXIMO.md`, `FLUXO.md` "O ensaio de prompt na sessão"): os scripts `avaliar:*` montam todos os pedidos de uma etapa, mandam um
 * lote só pela API de lote (`src/ia/lote.ts`, o mesmo caminho de `extrair`, metade do preço) e esperam o resultado, em vez de chamar o modelo um caso por vez.
 * Mesmos prompts, mesmo schema, mesmo esforço: só muda o jeito de chamar. Em mock o lote responde na hora, igual à chamada de sempre.
 *
 * **Custo:** o que o script imprime é calculado pelos tokens de entrada e saída que o lote devolve, pela metade do preço (`FATOR_LOTE`, x0,5). O lote NÃO devolve os tokens de cache de
 * prompt (que o preço cheio da chamada um por vez conta com desconto), então o número impresso pode ficar acima do que o console da Anthropic cobra de verdade; na dúvida, vale o console.
 *
 * `GOLDEN_SEM_LOTE=1` volta à chamada um por vez (para depurar um caso, ou quando a pessoa quer o resultado agora e aceita pagar o preço cheio).
 * `--direto` (ou `GOLDEN_SET_DIRETO=1`), em qualquer `avaliar:*`: as mesmas chamadas, mas pelo caminho normal (`src/ia/cliente.ts`), até 4 em paralelo, sem esperar a fila do lote. Para quando o
 * lote está parado na fila da API e o resultado é preciso agora. **O custo é o cheio, o dobro do lote**, e o cabeçalho avisa; o padrão continua sendo o lote.
 * Um lote pode levar até 24 h; em geral, minutos. O ajudante consulta de 30 em 30 segundos.
 *
 * **Qual IA responde (06/10/2026, o golden set do PR #142 rodou "simulado" sem ninguém ver):** toda rodada imprime, no cabeçalho, `IA: simulada` (o simulador, `AI_PROVIDER=mock`, sem chave ou com
 * o provedor forçado) ou `IA: real (modelo forte X, barato Y)`. E `--direto` com o simulador é RECUSADO: o `--direto` existe para medir o modelo de verdade com o resultado na hora, e o simulador
 * devolve notas fixas que parecem uma medida. Os testes do próprio ajudante liberam o simulador com `GOLDEN_PERMITE_SIMULADO=1`.
 */
import { gerarEstruturado, type ParametrosGeracao } from "../src/ia/cliente";
import { coletarResultadosLote, criarLote, statusLote } from "../src/ia/lote";
import { calcularCustoUsd } from "../src/ia/registro";
import type { NivelIA, ResultadoGeracao } from "../src/ia/tipos";
import { config } from "../src/lib/config";

const INTERVALO_MS = 30_000;
const LIMITE_ESPERA_MS = 26 * 60 * 60 * 1000;

/** O pedido de um caso: os mesmos campos de `gerarEstruturado` (sem imagens nem bloco variável, que o lote não leva). */
export type PedidoGolden<T> = Omit<ParametrosGeracao<T>, "imagens" | "sistemaVariavel">;

/** O caminho direto (`--direto` na linha de comando ou `GOLDEN_SET_DIRETO=1`): paralelo de até 4, preço cheio. */
export function goldenDireto(): boolean {
  return process.env.GOLDEN_SET_DIRETO === "1" || process.argv.includes("--direto");
}

/** Só o lote tem o desconto: a chamada um por vez (`GOLDEN_SEM_LOTE=1`) e a direta pagam o preço cheio. */
export function goldenEmLote(): boolean {
  return process.env.GOLDEN_SEM_LOTE !== "1" && !goldenDireto();
}

/** O cabeçalho que diz qual IA responde: o simulador ou o provedor real, com os modelos. Puro, para testar. */
export function descricaoDaIA(provedor: string, modeloForte: string, modeloBarato: string): string {
  return provedor === "mock"
    ? "IA: simulada (AI_PROVIDER=mock: nenhuma chamada de verdade, nenhum custo; as notas NÃO medem o modelo)"
    : `IA: real (modelo forte ${modeloForte}, barato ${modeloBarato})`;
}

/** A recusa de `--direto` com o simulador, ou nulo quando pode seguir. `permiteSimulado` é só para os testes do ajudante. Pura, para testar. */
export function recusaDoSimulado(provedor: string, direto: boolean, permiteSimulado: boolean): string | null {
  if (provedor === "mock" && direto && !permiteSimulado) {
    return "recusado: --direto (ou GOLDEN_SET_DIRETO=1) com a IA simulada. O simulador devolve notas fixas e não mede o modelo. Rode com AI_PROVIDER=anthropic e uma chave (ANTHROPIC_API_KEY_TESTES), ou tire o --direto para o ensaio sem custo.";
  }
  return null;
}

let anunciouIA = false;

/** O cabeçalho da IA, uma vez por rodada, antes da primeira chamada; recusa o `--direto` com o simulador. */
function anunciarIA(): void {
  const recusa = recusaDoSimulado(config.ia.provedor, goldenDireto(), process.env.GOLDEN_PERMITE_SIMULADO === "1");
  if (recusa) throw new Error(recusa);
  if (anunciouIA) return;
  anunciouIA = true;
  console.log(`[${descricaoDaIA(config.ia.provedor, config.ia.modeloForte, config.ia.modeloBarato)}]\n`);
}

const PARALELO_DIRETO = 4;
let avisouDireto = false;

/** O aviso do custo cheio, uma vez por rodada, antes da primeira chamada direta. */
function avisarCaminhoDireto(): void {
  if (avisouDireto) return;
  avisouDireto = true;
  console.log(`[direto] as chamadas vão pelo caminho normal, até ${PARALELO_DIRETO} em paralelo, sem a fila do lote: o custo é o preço CHEIO (o dobro do lote).\n`);
}

const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
const TENTATIVAS_DE_REDE = 5;

/** Um erro de rede na consulta do lote (já pago) não derruba a rodada: tenta de novo algumas vezes, com pausa, e só então desiste dizendo o id do lote. */
async function comTentativas<R>(loteId: string, o_que: string, fazer: () => Promise<R>): Promise<R> {
  let ultimo: unknown;
  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_REDE; tentativa++) {
    try {
      return await fazer();
    } catch (erro) {
      ultimo = erro;
      if (tentativa < TENTATIVAS_DE_REDE) await pausa(Math.min(INTERVALO_MS, tentativa * 2_000));
    }
  }
  throw new Error(`${o_que} do lote ${loteId} falhou ${TENTATIVAS_DE_REDE} vezes (o lote continua valendo no console): ${ultimo instanceof Error ? ultimo.message : String(ultimo)}`);
}

/**
 * Manda todos os pedidos (da mesma tarefa e do mesmo schema) num lote e devolve os resultados na MESMA ordem. Um caso que o lote devolve com erro derruba a rodada
 * com a lista dos casos (o golden set não aceita "alguns casos faltando"). `rotulo` só aparece no log de espera.
 */
export async function gerarVarios<T>(pedidos: PedidoGolden<T>[], rotulo: string): Promise<ResultadoGeracao<T>[]> {
  const resultados = await gerarVariosOuErro(pedidos, rotulo);
  const falhas = resultados.flatMap((r, indice) => (r instanceof Error ? [`caso ${indice + 1}: ${r.message}`] : []));
  if (falhas.length > 0) throw new Error(`o lote de ${rotulo} voltou com falha: ${falhas.join("; ")}`);
  return resultados as ResultadoGeracao<T>[];
}

/**
 * Como `gerarVarios`, mas um caso que falha vem como `Error` na posição dele em vez de derrubar a rodada (o golden set do briefing sempre pulou o caso com erro de rede ou
 * resposta truncada, sem perder os outros).
 */
export async function gerarVariosOuErro<T>(pedidos: PedidoGolden<T>[], rotulo: string): Promise<(ResultadoGeracao<T> | Error)[]> {
  if (pedidos.length === 0) return [];
  anunciarIA();
  if (goldenDireto()) {
    avisarCaminhoDireto();
    // Um grupo de até 4 chamadas por vez, cada uma com o seu erro à parte, na mesma ordem dos pedidos.
    const resultados: (ResultadoGeracao<T> | Error)[] = new Array(pedidos.length);
    let proximo = 0;
    const trabalhador = async () => {
      for (let indice = proximo++; indice < pedidos.length; indice = proximo++) {
        try {
          resultados[indice] = await gerarEstruturado(pedidos[indice]);
        } catch (erro) {
          resultados[indice] = erro instanceof Error ? erro : new Error(String(erro));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALELO_DIRETO, pedidos.length) }, trabalhador));
    return resultados;
  }
  if (!goldenEmLote()) {
    const resultados: (ResultadoGeracao<T> | Error)[] = [];
    for (const pedido of pedidos) {
      try {
        resultados.push(await gerarEstruturado(pedido));
      } catch (erro) {
        resultados.push(erro instanceof Error ? erro : new Error(String(erro)));
      }
    }
    return resultados;
  }

  const loteId = await criarLote(
    pedidos.map((pedido, indice) => ({
      customId: String(indice),
      tarefa: pedido.tarefa,
      nivel: pedido.nivel,
      schema: pedido.schema,
      sistemaEstavel: pedido.sistemaEstavel,
      entrada: pedido.entrada,
      maxTokens: pedido.maxTokens ?? 16000,
      effort: pedido.effort,
    })),
  );
  if (config.ia.provedor !== "mock") console.log(`[lote] ${rotulo}: ${pedidos.length} pedido(s) enviados (${loteId}), esperando...`);

  const inicio = Date.now();
  while ((await comTentativas(loteId, "a consulta", () => statusLote(loteId))) !== "concluido") {
    if (Date.now() - inicio > LIMITE_ESPERA_MS) throw new Error(`lote ${loteId} (${rotulo}) não terminou em 26 h`);
    await pausa(INTERVALO_MS);
  }

  const coletados = await comTentativas(loteId, "a coleta", () => coletarResultadosLote(loteId, pedidos[0].schema));
  const porId = new Map(coletados.map((c) => [c.customId, c]));
  return pedidos.map((_, indice): ResultadoGeracao<T> | Error => {
    const item = porId.get(String(indice));
    if (item?.status === "sucesso") {
      return { dados: item.dados, modelo: item.modelo, tokensEntrada: item.tokensEntrada, tokensSaida: item.tokensSaida, tokensCacheLeitura: 0, tokensCacheEscrita: 0 };
    }
    return new Error(item === undefined ? "sem resposta" : item.status === "erro" ? item.motivo : "expirado");
  });
}

/** O custo de um resultado: pela metade quando veio do lote (o fator do preço de lote), cheio na chamada um por vez. */
export function custoDoResultado(nivel: NivelIA, resultado: ResultadoGeracao<unknown>): number {
  return calcularCustoUsd(nivel, resultado, goldenEmLote());
}
