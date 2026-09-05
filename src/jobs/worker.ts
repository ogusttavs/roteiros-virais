/**
 * Processo do worker (etapa 6): `npm run worker`. Sobe o pg-boss, garante as
 * filas, registra os agendamentos e fica processando. Um job que falha
 * registra em `execucoes_job` e nao derruba o processo (`executarComRegistro`
 * cuida disso; so relanca quando o pg-boss deve mesmo tentar de novo, e
 * chama `Sentry.captureException`, etapa 13, decisao 1).
 *
 * `SIGTERM` (etapa 13, decisao 3, criterio de aceite da etapa 13: "derrubar
 * o container do worker, o Compose sobe de novo sozinho e o job seguinte
 * roda"): o Compose manda SIGTERM antes de matar o processo; sem um
 * handler, o Node encerra na hora, no meio de uma query, em vez de fechar o
 * pg-boss de forma limpa. `desligarComGraca` para de aceitar trabalho novo
 * e espera o job em andamento terminar (ate o limite do pg-boss) antes de
 * sair, para nunca deixar uma linha de `execucoes_job` presa em "rodando".
 */
import "dotenv/config";

import { agendarTudo, listarAgendamentos } from "./agenda";
import { rodarAnalisarVisual } from "./analisar-visual";
import { rodarColetaApify } from "./coleta-apify";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { desligarComGraca } from "./desligamento";
import { executarComRegistro } from "./execucoes";
import { rodarExtrair } from "./extrair";
import { rodarExtrairColeta } from "./extrair-coleta";
import { boss, FILAS, garantirFilas } from "./fila";
import { rodarLembrete } from "./lembrete";
import { rodarModeloNicho } from "./modelo-nicho";
import { rodarPontuar } from "./pontuar";
import { rodarTemasDoDia } from "./temas-do-dia";
import { rodarTranscrever } from "./transcrever";
import { rodarVigilancia } from "./vigilancia";

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
        console.error("worker nao parou com graca:", erro);
        process.exit(1);
      });
  });

  await boss().start();
  await garantirFilas();
  await agendarTudo();

  /**
   * `job[0]?.data?.nichoId` (etapa 24, parte 1): "coletar agora" na tela do
   * nicho manda esse dado ao enfileirar; o cron e o disparo manual em
   * `/admin/jobs` nao mandam nada, e `rodarColeta*` sem nichoId roda para
   * todos os nichos ativos, igual sempre foi.
   */
  await boss().work<{ nichoId?: number }>(FILAS.coletaYoutube, async (job) => {
    await executarComRegistro(FILAS.coletaYoutube, () => rodarColetaYoutube(job[0]?.data?.nichoId));
  });
  await boss().work<{ nichoId?: number }>(FILAS.coletaApify, async (job) => {
    await executarComRegistro(FILAS.coletaApify, () => rodarColetaApify(job[0]?.data?.nichoId));
  });
  await boss().work<{ nichoId?: number }>(FILAS.coletaNoticias, async (job) => {
    await executarComRegistro(FILAS.coletaNoticias, () => rodarColetaNoticias(job[0]?.data?.nichoId));
  });
  await boss().work(FILAS.pontuar, async () => {
    await executarComRegistro(FILAS.pontuar, rodarPontuar);
  });
  await boss().work(FILAS.vigilancia, async () => {
    await executarComRegistro(FILAS.vigilancia, rodarVigilancia);
  });
  await boss().work(FILAS.transcrever, async () => {
    await executarComRegistro(FILAS.transcrever, rodarTranscrever);
  });
  await boss().work(FILAS.extrair, async () => {
    await executarComRegistro(FILAS.extrair, rodarExtrair);
  });
  await boss().work(FILAS.extrairColeta, async () => {
    await executarComRegistro(FILAS.extrairColeta, rodarExtrairColeta);
  });
  await boss().work(FILAS.analisarVisual, async () => {
    await executarComRegistro(FILAS.analisarVisual, rodarAnalisarVisual);
  });
  await boss().work(FILAS.modeloNicho, async () => {
    await executarComRegistro(FILAS.modeloNicho, rodarModeloNicho);
  });
  await boss().work(FILAS.temasDoDia, async () => {
    await executarComRegistro(FILAS.temasDoDia, rodarTemasDoDia);
  });
  await boss().work(FILAS.lembrete, async () => {
    await executarComRegistro(FILAS.lembrete, rodarLembrete);
  });

  console.log("worker no ar.");
  console.log(listarAgendamentos());
}

main().catch((erro) => {
  console.error("worker nao subiu:", erro);
  process.exit(1);
});
