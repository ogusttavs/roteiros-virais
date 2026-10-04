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
import { rodarAnalisarPerfil, type PayloadAnalisarPerfil } from "./analisar-perfil";
import { rodarAnalisarVisual } from "./analisar-visual";
import { rodarAprenderCliente } from "./aprender-cliente";
import { rodarColetaApify } from "./coleta-apify";
import { rodarColetaMeioDia } from "./coleta-meio-dia";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { rodarContasBase } from "./contas-base";
import { rodarCurvaCliente } from "./curva-cliente";
import { rodarDescobertaInstagram } from "./descoberta-instagram";
import { desligarComGraca } from "./desligamento";
import { rodarEmailAcompanhamento } from "./email-acompanhamento";
import { type PayloadEntenderMarca, tratarJobEntenderMarca } from "./entender-marca";
import { executarComRegistro } from "./execucoes";
import { rodarExtrair } from "./extrair";
import { rodarExtrairAgora } from "./extrair-agora";
import { rodarExtrairColeta } from "./extrair-coleta";
import { rodarExtrairSemFala } from "./extrair-sem-fala";
import { boss, FILAS, garantirFilas } from "./fila";
import { rodarLembrete } from "./lembrete";
import { rodarMetaContas } from "./meta-contas";
import { rodarMetaHashtags } from "./meta-hashtags";
import { rodarModeloNicho } from "./modelo-nicho";
import { rodarPesquisaDeSetor } from "./pesquisa-de-setor";
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
    await executarComRegistro(FILAS.coletaApify, (execucaoId) =>
      rodarColetaApify(job[0]?.data?.nichoId, execucaoId),
    );
  });
  await boss().work(FILAS.coletaMeioDia, async () => {
    await executarComRegistro(FILAS.coletaMeioDia, (execucaoId) => rodarColetaMeioDia(execucaoId));
  });
  await boss().work<{ nichoId?: number }>(FILAS.coletaNoticias, async (job) => {
    await executarComRegistro(FILAS.coletaNoticias, () => rodarColetaNoticias(job[0]?.data?.nichoId));
  });
  await boss().work(FILAS.contasBase, async () => {
    await executarComRegistro(FILAS.contasBase, rodarContasBase);
  });
  await boss().work<{ nichoId?: number }>(FILAS.metaContas, async (job) => {
    await executarComRegistro(FILAS.metaContas, () => rodarMetaContas(job[0]?.data?.nichoId));
  });
  await boss().work<{ nichoId?: number }>(FILAS.metaHashtags, async (job) => {
    await executarComRegistro(FILAS.metaHashtags, () => rodarMetaHashtags(job[0]?.data?.nichoId));
  });
  await boss().work<{ nichoId?: number }>(FILAS.descobertaInstagram, async (job) => {
    await executarComRegistro(FILAS.descobertaInstagram, () => rodarDescobertaInstagram(job[0]?.data?.nichoId));
  });
  await boss().work(FILAS.pontuar, async () => {
    await executarComRegistro(FILAS.pontuar, rodarPontuar);
  });
  await boss().work(FILAS.vigilancia, async () => {
    await executarComRegistro(FILAS.vigilancia, rodarVigilancia);
  });
  /** M2, item 0a2 da revisão do PR #73: com `nichoId`, só aquele setor (a cadeia da primeira carga). */
  await boss().work<{ nichoId?: number }>(FILAS.transcrever, async (job) => {
    await executarComRegistro(FILAS.transcrever, () => rodarTranscrever(job[0]?.data?.nichoId));
  });
  await boss().work(FILAS.extrair, async () => {
    await executarComRegistro(FILAS.extrair, rodarExtrair);
  });
  /** M1, item 1 e 4: sem `nichoId`, roda para todo setor novo (o cron não manda nada); com, só aquele setor ("rodar a primeira coleta agora" do admin). */
  await boss().work<{ nichoId?: number }>(FILAS.extrairAgora, async (job) => {
    await executarComRegistro(FILAS.extrairAgora, () => rodarExtrairAgora(job[0]?.data?.nichoId));
  });
  await boss().work(FILAS.extrairColeta, async () => {
    await executarComRegistro(FILAS.extrairColeta, rodarExtrairColeta);
  });
  await boss().work(FILAS.analisarVisual, async () => {
    await executarComRegistro(FILAS.analisarVisual, rodarAnalisarVisual);
  });
  /** M3, item 2: sem `nichoId`, roda para todo setor ativo que aceita "vídeo sem fala vale" (o cron diário). */
  await boss().work<{ nichoId?: number; soFicha?: boolean }>(FILAS.extrairSemFala, async (job) => {
    await executarComRegistro(FILAS.extrairSemFala, () => rodarExtrairSemFala(job[0]?.data?.nichoId, job[0]?.data?.soFicha === true));
  });
  await boss().work(FILAS.modeloNicho, async () => {
    await executarComRegistro(FILAS.modeloNicho, rodarModeloNicho);
  });
  /** M1, item 2: com `nichoId`, só aquele setor, e só se ele ainda não tem tema hoje; sem, comportamento de sempre. */
  await boss().work<{ nichoId?: number }>(FILAS.temasDoDia, async (job) => {
    await executarComRegistro(FILAS.temasDoDia, () => rodarTemasDoDia(job[0]?.data?.nichoId));
  });
  /** M2: sem `nichoId`, roda para todos os nichos ativos (o cron mensal); com, só aquele setor (criação ou "Pesquisar de novo"). */
  await boss().work<{ nichoId?: number }>(FILAS.pesquisaDeSetor, async (job) => {
    await executarComRegistro(FILAS.pesquisaDeSetor, () => rodarPesquisaDeSetor(job[0]?.data?.nichoId));
  });
  await boss().work(FILAS.lembrete, async () => {
    await executarComRegistro(FILAS.lembrete, () => rodarLembrete());
  });
  await boss().work(FILAS.curvaCliente, async () => {
    await executarComRegistro(FILAS.curvaCliente, () => rodarCurvaCliente());
  });
  await boss().work(FILAS.emailAcompanhamento, async () => {
    await executarComRegistro(FILAS.emailAcompanhamento, () => rodarEmailAcompanhamento());
  });
  /** Por evento (E27, parte 2, item 2): `reprovarERescrever` manda `{ clienteId }` ao enfileirar. */
  await boss().work<{ clienteId: number }>(FILAS.aprenderCliente, async (job) => {
    await executarComRegistro(FILAS.aprenderCliente, () => rodarAprenderCliente(job[0].data.clienteId));
  });
  /** Por evento (E38, partes 2 e 3): `enfileirarAnaliseDePerfil`/`enfileirarAnaliseDaPropriaMarca` mandam o payload inteiro. */
  await boss().work<PayloadAnalisarPerfil>(FILAS.analisarPerfil, async (job) => {
    await executarComRegistro(FILAS.analisarPerfil, () => rodarAnalisarPerfil(job[0].data));
  });
  /**
   * E38 PR 2: dois modos. O cron diário manda `null` (o despachante); um evento ou o próprio
   * despachante mandam `{ clienteId, origem }` (`payloadDoJob`, testado: o cron nunca traz dado).
   */
  await boss().work<PayloadEntenderMarca>(FILAS.entenderMarca, async (job) => {
    await tratarJobEntenderMarca(job, FILAS.entenderMarca);
  });

  console.log("worker no ar.");
  console.log(listarAgendamentos());
}

main().catch((erro) => {
  console.error("worker nao subiu:", erro);
  process.exit(1);
});
