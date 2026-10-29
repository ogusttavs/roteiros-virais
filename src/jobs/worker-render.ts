/**
 * O processo do contêiner de render (E47 PR 4): `tsx src/jobs/worker-render.ts`. A mesma imagem do worker, outro papel. Só consome a fila `renderizar-edicao`, UM vídeo por vez
 * (`localConcurrency` 1 e um job por busca), e não registra nenhum agendamento nem outra fila: o worker comum cuida do resto. O contêiner tem `cpus: 1.0` no Compose, então o ffmpeg nunca
 * rouba processador do painel nem do OdontoTech, que dividem a máquina.
 *
 * Desliga com graça no SIGTERM, como o worker comum: o pg-boss espera o job em andamento (o ffmpeg) até o teto da biblioteca; o que não terminar volta para a fila pela limpeza de hora em hora.
 */
import "dotenv/config";

import { desligarComGraca } from "./desligamento";
import { executarComRegistro } from "./execucoes";
import { boss, FILAS, garantirFilas } from "./fila";
import { rodarRenderizarEdicao, type PayloadRenderizarEdicao } from "./renderizar-edicao";

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

  await boss().work<PayloadRenderizarEdicao>(FILAS.renderizarEdicao, { batchSize: 1, localConcurrency: 1 }, async (job) => {
    const { edicaoId, perfil } = job[0].data;
    await executarComRegistro(FILAS.renderizarEdicao, () => rodarRenderizarEdicao(edicaoId, perfil));
  });

  console.log("render no ar.");
}

main().catch((erro) => {
  console.error("render nao subiu:", erro);
  process.exit(1);
});
