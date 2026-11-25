/**
 * O processo do contêiner de render (E47 PR 4): `tsx src/jobs/worker-render.ts`. A mesma imagem do worker, outro papel. Só consome as filas `renderizar-edicao` e (E68 A2) `renderizar-animacao`,
 * UM vídeo por vez (`localConcurrency` 1 e um job por busca em cada fila, e `umPorVez` põe as duas filas na mesma fila de espera: o 1 vCPU nunca monta dois vídeos juntos), e não registra nenhum agendamento nem outra fila: o worker comum cuida do resto. O contêiner tem `cpus: 1.0` no Compose, então o ffmpeg nunca
 * rouba processador do painel nem do OdontoTech, que dividem a máquina.
 *
 * Desliga com graça no SIGTERM, como o worker comum: o pg-boss espera o job em andamento (o ffmpeg) até o teto da biblioteca; o que não terminar volta para a fila pela limpeza de hora em hora.
 */
import "dotenv/config";

import { recolherAnimacoesOrfas } from "@/servicos/render-animacao";
import { recolherRendersOrfaos } from "@/servicos/render-edicao";

import { desligarComGraca } from "./desligamento";
import { executarComRegistro } from "./execucoes";
import { boss, FILAS, garantirFilas } from "./fila";
import { rodarRenderizarAnimacao, type PayloadRenderizarAnimacao } from "./renderizar-animacao";
import { rodarRenderizarEdicao, type PayloadRenderizarEdicao } from "./renderizar-edicao";

/** Os dois trabalhos (edição e animação) nunca rodam ao mesmo tempo neste contêiner: cada um espera o anterior terminar, erro ou não. */
let anterior: Promise<unknown> = Promise.resolve();
function umPorVez<T>(trabalho: () => Promise<T>): Promise<T> {
  const este = anterior.then(trabalho, trabalho);
  anterior = este.catch(() => undefined);
  return este;
}

async function main(): Promise<void> {
  const { deveInicializarSentry, opcoesSentry } = await import("@/lib/sentry");
  const opcoesDoSentry = opcoesSentry();
  if (deveInicializarSentry(opcoesDoSentry.dsn)) {
    const Sentry = await import("@sentry/node");
    Sentry.init(opcoesDoSentry);
  }

  process.on("SIGTERM", () => {
    desligarComGraca(boss(), "SIGTERM")
      .then(() => process.exit(0))
      .catch((erro: unknown) => {
        console.error("render nao parou com graca:", erro);
        process.exit(1);
      });
  });

  // Este processo só trabalha; quem agenda cron é o worker comum. `schedule: false` não existe nesta versão como opção de `work`, e o `start()` do pg-boss aceita vários processos.
  await boss().start();
  await garantirFilas();
  const recolhidos = await recolherRendersOrfaos();
  if (recolhidos > 0) console.log(`render recolheu ${recolhidos} edicao(oes) que o anterior deixou no meio.`);

  await boss().work<PayloadRenderizarEdicao>(FILAS.renderizarEdicao, { batchSize: 1, localConcurrency: 1 }, async (job) => {
    const { edicaoId, perfil } = job[0].data;
    await umPorVez(() => executarComRegistro(FILAS.renderizarEdicao, () => rodarRenderizarEdicao(edicaoId, perfil)));
  });

  const animacoesRecolhidas = await recolherAnimacoesOrfas();
  if (animacoesRecolhidas > 0) console.log(`render recolheu ${animacoesRecolhidas} animacao(oes) que o anterior deixou no meio.`);

  await boss().work<PayloadRenderizarAnimacao>(FILAS.renderizarAnimacao, { batchSize: 1, localConcurrency: 1 }, async (job) => {
    const { animacaoId, perfil } = job[0].data;
    await umPorVez(() => executarComRegistro(FILAS.renderizarAnimacao, () => rodarRenderizarAnimacao(animacaoId, perfil)));
  });

  console.log("render no ar.");
}

main().catch((erro) => {
  console.error("render nao subiu:", erro);
  process.exit(1);
});
