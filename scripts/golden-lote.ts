/**
 * O golden set pelo lote (item pequeno do `PROXIMO.md`, `FLUXO.md` "O ensaio de prompt na sessão"): os scripts `avaliar:*` montam todos os pedidos de uma etapa, mandam um
 * lote só pela API de lote (`src/ia/lote.ts`, o mesmo caminho de `extrair`, metade do preço) e esperam o resultado, em vez de chamar o modelo um caso por vez.
 * Mesmos prompts, mesmo schema, mesmo esforço: só muda o jeito de chamar. Em mock o lote responde na hora, igual à chamada de sempre.
 *
 * `GOLDEN_SEM_LOTE=1` volta à chamada um por vez (para depurar um caso, ou quando a pessoa quer o resultado agora e aceita pagar o preço cheio).
 * Um lote pode levar até 24 h; em geral, minutos. O ajudante consulta de 30 em 30 segundos.
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

export function goldenEmLote(): boolean {
  return process.env.GOLDEN_SEM_LOTE !== "1";
}

const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

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
  while ((await statusLote(loteId)) !== "concluido") {
    if (Date.now() - inicio > LIMITE_ESPERA_MS) throw new Error(`lote ${loteId} (${rotulo}) não terminou em 26 h`);
    await pausa(INTERVALO_MS);
  }

  const coletados = await coletarResultadosLote(loteId, pedidos[0].schema);
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
