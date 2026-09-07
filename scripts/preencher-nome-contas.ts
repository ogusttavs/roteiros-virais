/**
 * Preenche `contas.nome` das contas do YouTube ja coletadas antes de a
 * coleta gravar esse campo (etapa "acabamento visual 2", achado do
 * Gustavo no iPad: o cartao de referencias mostrava o id do canal em vez
 * do nome). TikTok e Instagram ja gravam `nome` desde a etapa 6, parte 2;
 * so o YouTube guarda o id do canal em `contas.handle`, entao so ele
 * precisa de backfill.
 *
 * `channels.list` em lote de 50 ids (`buscarCanaisPorId`, 1 unidade por
 * chamada), dentro da cota diaria de 9000 unidades: roda uma vez, `npm run
 * preencher:nome-contas`, e registra o gasto em `consumo_api` para a
 * coleta automatica do dia nao estourar a cota.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { consumoApi, contas } from "@/db/schema";
import { hojeISO } from "@/lib/config";

import { buscarCanaisPorId, CUSTO_LISTA } from "../src/jobs/youtube-api";

async function registrarConsumo(unidades: number): Promise<void> {
  if (unidades === 0) return;
  await db()
    .insert(consumoApi)
    .values({ fonte: "youtube", data: hojeISO(), unidades })
    .onConflictDoUpdate({
      target: [consumoApi.fonte, consumoApi.data],
      set: { unidades: sql`${consumoApi.unidades} + ${unidades}`, atualizadoEm: new Date() },
    });
}

export async function preencherNomeContas(): Promise<{
  contasSemNome: number;
  contasAtualizadas: number;
  canaisNaoEncontrados: number;
  unidadesGastas: number;
}> {
  const semNome = await db()
    .select({ id: contas.id, handle: contas.handle })
    .from(contas)
    .where(and(eq(contas.plataforma, "youtube"), isNull(contas.nome)));

  let contasAtualizadas = 0;
  let unidadesGastas = 0;

  for (let i = 0; i < semNome.length; i += 50) {
    const lote = semNome.slice(i, i + 50);
    unidadesGastas += CUSTO_LISTA;
    await registrarConsumo(CUSTO_LISTA);

    const resposta = await buscarCanaisPorId(lote.map((c) => c.handle));
    const nomesPorId = new Map((resposta.items ?? []).map((item) => [item.id, item.snippet.title]));

    for (const conta of lote) {
      const nome = nomesPorId.get(conta.handle);
      if (!nome) continue;
      await db().update(contas).set({ nome, atualizadoEm: new Date() }).where(eq(contas.id, conta.id));
      contasAtualizadas += 1;
    }
  }

  return {
    contasSemNome: semNome.length,
    contasAtualizadas,
    canaisNaoEncontrados: semNome.length - contasAtualizadas,
    unidadesGastas,
  };
}

if (require.main === module) {
  preencherNomeContas()
    .then((resultado) => {
      console.log(JSON.stringify(resultado, null, 2));
      process.exit(0);
    })
    .catch((erro) => {
      console.error(erro);
      process.exit(1);
    });
}
