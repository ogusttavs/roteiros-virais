/**
 * Job `transcrever-edicao` (E47 PR 2): por evento, nunca por horário. `receberVideoDaEdicao` (`servicos/edicao.ts`) manda `{ edicaoId }` quando o vídeo bruto termina de chegar e foi aceito. Aqui o
 * worker extrai o áudio (16 kHz mono), calcula a curva de energia, transcreve na Groq com o tempo de cada palavra e um "prompt" de nomes tirado do que a conta sabe de si, e guarda as palavras e a
 * curva na edição (`transcrito`). O custo da Groq vai para `custos_externos` (dentro de `transcreverComPalavras`, em dólar) e os segundos de áudio para o contador do dia em `consumo_api`; o custo
 * também fica na própria edição.
 *
 * Idempotente e segura para repetir: só quem consegue passar a edição de `guardado` para `transcrevendo` (um UPDATE condicional) trabalha. Uma falha de rede ou da Groq devolve a edição a `guardado` e
 * relança, para a fila tentar de novo (2 repetições); na terceira tentativa a edição falha com a frase. Falta de fala falha na hora, sem repetir. Nada de fala, caminho de arquivo ou chave vai para o
 * resumo (a tela de rotinas do admin o mostra): só números e o estado.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, sql } from "drizzle-orm";

import { TENTATIVAS_DA_TRANSCRICAO } from "@/config/edicao";
import { db } from "@/db";
import { edicoes } from "@/db/schema";
import { apagarArquivoDaEdicao, arquivoExiste, caminhoNoVolume } from "@/edicao/arquivos";
import { prepararAudio } from "@/edicao/audio";
import { energiaParaBanco } from "@/edicao/guardada";
import { promptDeNomes } from "@/edicao/nomes";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";
import { perfilDoCliente } from "@/servicos/briefing";
import { clientePorId } from "@/servicos/clientes";
import { registrarConsumoDeAudioGroq } from "@/servicos/custos-externos";
import { fraseDaEdicao, type CodigoDaEdicao } from "@/textos/edicao";

import { transcreverComPalavras, type ResultadoComPalavras } from "./groq-api";

export type PayloadTranscreverEdicao = { edicaoId: number };

export type DepsDaTranscricao = {
  agora?: () => Date;
  /** Quem enfileira a decisão da edição depois da transcrição (o padrão põe na fila `decidir-edicao`). Os testes trocam para não depender da fila. */
  enfileirarDecisao?: (edicaoId: number) => Promise<void>;
  transcrever?: (caminhoDoAudio: string, opcoes: { idiomaConhecido?: "pt"; prompt?: string; detalheDoCusto?: Record<string, unknown> }) => Promise<ResultadoComPalavras>;
};

/** Falha a edição com a frase e apaga o bruto na hora: sem transcrição não há o que editar, e a pessoa vai enviar outro. */
async function falhar(edicaoId: number, codigo: CodigoDaEdicao, agora: Date): Promise<void> {
  const [linha] = await db()
    .update(edicoes)
    .set({ estado: "falhou", motivo: fraseDaEdicao(codigo), atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, "transcrevendo")))
    .returning({ caminhoBruto: edicoes.caminhoBruto });
  if (!linha) return;
  await apagarArquivoDaEdicao(linha.caminhoBruto);
  await db().update(edicoes).set({ caminhoBruto: null, brutoApagadoEm: agora }).where(eq(edicoes.id, edicaoId));
}

async function enfileirarDecisao(edicaoId: number): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.decidirEdicao, { edicaoId }, { singletonKey: `decisao-${edicaoId}` });
}

export async function rodarTranscreverEdicao(edicaoId: number, deps: DepsDaTranscricao = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(edicaoId) || edicaoId <= 0) throw new Error("uso: npm run job -- transcrever-edicao <edicaoId>");
  const agora = deps.agora ? deps.agora() : new Date();

  // Só passa quem consegue reservar: duas execuções (a fila e a limpeza, uma repetição) nunca transcrevem a mesma edição ao mesmo tempo.
  const [edicao] = await db()
    .update(edicoes)
    .set({ estado: "transcrevendo", tentativas: sql`${edicoes.tentativas} + 1`, atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, "guardado")))
    .returning();
  if (!edicao) {
    const [atual] = await db().select({ estado: edicoes.estado }).from(edicoes).where(eq(edicoes.id, edicaoId));
    return { edicaoId, pulou: atual?.estado ?? "inexistente" };
  }

  if (!(await arquivoExiste(edicao.caminhoBruto))) {
    await falhar(edicaoId, "sumiu", agora);
    return { edicaoId, estado: "falhou", motivo: "sumiu" };
  }

  const pasta = await mkdtemp(join(tmpdir(), "edicao-"));
  try {
    let audio;
    try {
      audio = await prepararAudio(caminhoNoVolume(edicao.caminhoBruto as string), pasta);
    } catch {
      await falhar(edicaoId, "nao-abriu", agora);
      return { edicaoId, estado: "falhou", motivo: "audio" };
    }

    const [marca, perfil] = await Promise.all([clientePorId(edicao.clienteId), perfilDoCliente(edicao.clienteId)]);
    const prompt = marca
      ? promptDeNomes({ nomeDaMarca: marca.nome, cidade: marca.cidade, regiao: marca.alcance === "local" ? marca.regiao : null, oQueVende: perfil?.fatos.oQueVende, concorrentes: perfil?.fatos.concorrentes })
      : "";
    // O produto é brasileiro primeiro: a marca que vende no Brasil ou na própria região fala português. As outras deixam a Groq decidir.
    const idiomaConhecido = !marca || marca.alcance === null || marca.alcance === "brasil" || marca.alcance === "local" ? ("pt" as const) : undefined;

    let resultado: ResultadoComPalavras;
    try {
      resultado = await (deps.transcrever ?? transcreverComPalavras)(audio.wav, { idiomaConhecido, prompt: prompt || undefined, detalheDoCusto: { edicaoId } });
    } catch (erro) {
      if (edicao.tentativas >= TENTATIVAS_DA_TRANSCRICAO) {
        logger.warn({ edicaoId, tentativas: edicao.tentativas }, "edicao: a Groq nao transcreveu e as tentativas acabaram");
        await falhar(edicaoId, "nao-entendeu", agora);
        return { edicaoId, estado: "falhou", motivo: "groq", tentativas: edicao.tentativas };
      }
      // Volta para `guardado` e deixa a fila repetir (ou a limpeza de hora em hora enfileirar de novo).
      await db()
        .update(edicoes)
        .set({ estado: "guardado", atualizadaEm: agora })
        .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, "transcrevendo")));
      throw erro;
    }

    await registrarConsumoDeAudioGroq(resultado.duracaoS);
    if (resultado.semFala || resultado.palavras.length === 0) {
      await db()
        .update(edicoes)
        .set({ custoTranscricaoUsd: resultado.custoUsd.toFixed(6) })
        .where(eq(edicoes.id, edicaoId));
      await falhar(edicaoId, "sem-fala", agora);
      return { edicaoId, estado: "falhou", motivo: "sem-fala", segundosDeAudio: Math.round(resultado.duracaoS) };
    }

    const [transcrita] = await db()
      .update(edicoes)
      .set({
        estado: "transcrito",
        palavras: resultado.palavras,
        energia: energiaParaBanco(audio.energia),
        idioma: resultado.idiomaDetectado,
        custoTranscricaoUsd: resultado.custoUsd.toFixed(6),
        atualizadaEm: agora,
      })
      .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, "transcrevendo")))
      .returning({ id: edicoes.id });
    if (transcrita) {
      // A decisão da edição (E47 PR 3) nasce daqui. Se a fila falhar, a limpeza de hora em hora enfileira de novo a edição que ficou `transcrito` sem ninguém pegar.
      try {
        await (deps.enfileirarDecisao ?? enfileirarDecisao)(edicaoId);
      } catch (erro) {
        logger.warn({ err: erro, edicaoId }, "edicao: nao foi possivel enfileirar a decisao");
      }
    }
    return { edicaoId, estado: "transcrito", palavras: resultado.palavras.length, segundosDeAudio: Math.round(resultado.duracaoS), custoUsd: Number(resultado.custoUsd.toFixed(6)) };
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

