/**
 * Job `analisar-perfil` (E38, partes 2 e 3, "o contexto da marca"): confere na API de verdade um
 * perfil citado pelo cliente (concorrente ou admira, `perfisCitados`) ou da própria marca
 * (`clientes.perfis`), lê os últimos vídeos só daquela conta (nunca entra na base do nicho) e
 * escreve a leitura curta. Por evento, como `aprenderCliente`: só roda com o perfil certo, que
 * `enfileirarAnaliseDePerfil`/`enfileirarAnaliseDaPropriaMarca` (`src/servicos/perfis-analisados.ts`)
 * sabem qual é.
 *
 * TikTok fica de fora enquanto o Apify estiver suspenso (decisão de 09/09/2026): um perfil citado
 * nessa rede grava `existeNaRede: false` com o motivo, sem tentar a API.
 *
 * Reusa a mesma conferência do `pesquisa-de-setor` (M2): `confirmarYoutube`/`confirmarInstagram`
 * buscam até 20 vídeos (o mesmo teto que a pesquisa de setor já paga, API grátis no Instagram e 3
 * unidades no YouTube, independente de quantos vídeos voltam); esta etapa só guarda e analisa os
 * `TETO_VIDEOS_LEITURA` mais recentes, o "teto pequeno por conta" do escopo 5.x, para o custo de
 * IA (a leitura e a classificação de setor) ficar baixo.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clientes, contas, nichos, perfisAnalisados, type Plataforma } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as analisarPerfilCitado from "@/ia/prompts/analisarPerfilCitado";
import { calcularCustoUsd, registrarGeracao } from "@/ia/registro";
import { ErroMetaApi, erroMetaEhDaConta } from "@/jobs/meta-api";
import { logger } from "@/lib/log";
import { perfilDoCliente } from "@/servicos/briefing";

import { upsertConta, upsertVideo } from "./coleta-comum";
import {
  confirmarInstagram,
  confirmarYoutube,
  passaNoFiltroDeCodigo,
  passaNoFiltroDeSetor,
  type ContaConfirmada,
} from "./pesquisa-de-setor";
import { ErroYoutubeApi } from "./youtube-api";

/** "Teto pequeno por conta" (escopo 5.x): quantos vídeos entram na leitura e na classificação de
 * setor, por perfil. Menor que o `VIDEOS_POR_CANDIDATO` (20) do `pesquisa-de-setor`, que decide se
 * uma conta vira semente do setor inteiro; aqui é só a leitura de um perfil para um cliente só. */
export const TETO_VIDEOS_LEITURA = 10;

export type PayloadAnalisarPerfil = {
  clienteId: number;
  /** `null` é o perfil da própria marca (`clientes.perfis`); preenchido é um `perfisCitados.id`. */
  perfilCitadoId: number | null;
  origem: "citado" | "propria_marca";
  tipoCitado: "concorrente" | "admira" | null;
  rede: Plataforma;
  handle: string;
};

async function gravarResultado(
  payload: PayloadAnalisarPerfil,
  dados: {
    existeNaRede: boolean;
    seguidores?: number | null;
    contagemVideosLidos?: number;
    leitura?: string | null;
    qualificaParaSetor?: boolean;
    erro?: string | null;
  },
): Promise<void> {
  await db()
    .insert(perfisAnalisados)
    .values({
      clienteId: payload.clienteId,
      perfilCitadoId: payload.perfilCitadoId,
      origem: payload.origem,
      rede: payload.rede,
      handle: payload.handle,
      existeNaRede: dados.existeNaRede,
      seguidores: dados.seguidores ?? null,
      contagemVideosLidos: dados.contagemVideosLidos ?? 0,
      leitura: dados.leitura ?? null,
      qualificaParaSetor: dados.qualificaParaSetor ?? false,
      erro: dados.erro ?? null,
      atualizadoEm: new Date(),
    })
    .onConflictDoUpdate({
      target: [perfisAnalisados.clienteId, perfisAnalisados.rede, perfisAnalisados.handle],
      set: {
        perfilCitadoId: payload.perfilCitadoId,
        origem: payload.origem,
        existeNaRede: dados.existeNaRede,
        seguidores: dados.seguidores ?? null,
        contagemVideosLidos: dados.contagemVideosLidos ?? 0,
        leitura: dados.leitura ?? null,
        qualificaParaSetor: dados.qualificaParaSetor ?? false,
        erro: dados.erro ?? null,
        atualizadoEm: new Date(),
      },
    });
}

function papelDoPerfil(payload: PayloadAnalisarPerfil): "concorrente" | "admira" | "propria_marca" {
  if (payload.origem === "propria_marca") return "propria_marca";
  return payload.tipoCitado ?? "concorrente";
}

export async function rodarAnalisarPerfil(payload: PayloadAnalisarPerfil): Promise<Record<string, unknown>> {
  if (payload.rede === "tiktok") {
    await gravarResultado(payload, { existeNaRede: false, erro: "TikTok fora do ar por enquanto (Apify suspenso)." });
    return { clienteId: payload.clienteId, rede: payload.rede, handle: payload.handle, pulado: "tiktok_suspenso" };
  }

  const [cliente] = await db().select().from(clientes).where(eq(clientes.id, payload.clienteId));
  if (!cliente) return { clienteId: payload.clienteId, erro: "cliente nao encontrado" };

  let confirmado: ContaConfirmada | null;
  try {
    confirmado = payload.rede === "youtube" ? await confirmarYoutube(payload.handle) : await confirmarInstagram(payload.handle);
  } catch (erro) {
    if (erro instanceof ErroYoutubeApi && erro.message.includes("playlistNotFound")) {
      await gravarResultado(payload, { existeNaRede: false, erro: "o canal nao tem video publicado." });
      return { clienteId: payload.clienteId, rede: payload.rede, handle: payload.handle, descartado: "sem_videos" };
    }
    if (erro instanceof ErroMetaApi && erroMetaEhDaConta(erro)) {
      await gravarResultado(payload, { existeNaRede: false, erro: "perfil pessoal ou com restricao de idade." });
      return { clienteId: payload.clienteId, rede: payload.rede, handle: payload.handle, descartado: "conta_restrita" };
    }
    logger.error({ err: erro, clienteId: payload.clienteId, rede: payload.rede, handle: payload.handle }, "analisar-perfil: falha conferindo o perfil");
    throw erro;
  }

  if (!confirmado) {
    await gravarResultado(payload, { existeNaRede: false, erro: "perfil nao encontrado na rede." });
    return { clienteId: payload.clienteId, rede: payload.rede, handle: payload.handle, descartado: "nao_encontrado" };
  }

  const videosParaLer = confirmado.videos.slice(0, TETO_VIDEOS_LEITURA);
  const titulos = videosParaLer.map((v) => v.titulo).filter((t): t is string => Boolean(t));

  const perfilCompilado = await perfilDoCliente(payload.clienteId);
  let custoUsd = 0;

  const leituraResultado = await gerarEstruturado({
    tarefa: "analisarPerfilCitado",
    nivel: analisarPerfilCitado.nivel,
    effort: analisarPerfilCitado.esforco,
    schema: analisarPerfilCitado.schema,
    sistemaEstavel: analisarPerfilCitado.montarSistemaEstavel(),
    entrada: analisarPerfilCitado.montarEntrada({
      tipo: papelDoPerfil(payload),
      nomeDoCliente: cliente.nome,
      oQueVende: perfilCompilado?.fatos.oQueVende ?? "",
      handle: confirmado.handle,
      titulos,
    }),
  });
  await registrarGeracao({
    tarefa: "analisarPerfilCitado",
    versaoPrompt: analisarPerfilCitado.versao,
    modelo: leituraResultado.modelo,
    nivel: analisarPerfilCitado.nivel,
    clienteId: payload.clienteId,
    entradas: { rede: payload.rede, handle: payload.handle, origem: payload.origem },
    saida: leituraResultado.dados,
    uso: {
      tokensEntrada: leituraResultado.tokensEntrada,
      tokensSaida: leituraResultado.tokensSaida,
      tokensCacheLeitura: leituraResultado.tokensCacheLeitura,
      tokensCacheEscrita: leituraResultado.tokensCacheEscrita,
    },
  });
  custoUsd += calcularCustoUsd(analisarPerfilCitado.nivel, {
    tokensEntrada: leituraResultado.tokensEntrada,
    tokensSaida: leituraResultado.tokensSaida,
    tokensCacheLeitura: leituraResultado.tokensCacheLeitura,
    tokensCacheEscrita: leituraResultado.tokensCacheEscrita,
  });

  // "Vira candidato a conta do setor" (parte 3): mesma régua do pesquisa-de-setor, só quando o
  // cliente já tem um setor escolhido; sem automático, o admin é quem liga (`virarContaDoSetor`).
  let qualificaParaSetor = false;
  if (cliente.nichoId) {
    const [nicho] = await db().select().from(nichos).where(eq(nichos.id, cliente.nichoId));
    if (nicho && passaNoFiltroDeCodigo({ ...confirmado, videos: videosParaLer }) === null) {
      try {
        const classificacao = await passaNoFiltroDeSetor({ ...confirmado, videos: videosParaLer }, nicho.nome, nicho.termos);
        custoUsd += classificacao.custoUsd;
        qualificaParaSetor = classificacao.pertence;
      } catch (erro) {
        logger.error({ err: erro, clienteId: payload.clienteId, rede: payload.rede, handle: payload.handle }, "analisar-perfil: falha classificando para o setor");
      }
    }
  }

  await gravarResultado(payload, {
    existeNaRede: true,
    seguidores: confirmado.seguidores,
    contagemVideosLidos: videosParaLer.length,
    leitura: leituraResultado.dados.leitura,
    qualificaParaSetor,
  });

  return {
    clienteId: payload.clienteId,
    rede: payload.rede,
    handle: payload.handle,
    contagemVideosLidos: videosParaLer.length,
    qualificaParaSetor,
    custoUsd,
  };
}

/**
 * O admin liga (parte 3, sem automático): o perfil analisado que já qualificou vira uma conta
 * vigiada do setor, com a mesma conferência fresca (a leitura pode ter dias; promover é raro,
 * então vale pagar a chamada de novo em vez de guardar vídeo "para o caso de um dia precisar").
 */
export async function virarContaDoSetor(perfilAnalisadoId: number): Promise<{ contaId: number }> {
  const [linha] = await db().select().from(perfisAnalisados).where(eq(perfisAnalisados.id, perfilAnalisadoId));
  if (!linha) throw new Error("perfil analisado nao encontrado.");
  if (!linha.qualificaParaSetor) throw new Error("este perfil nao passou na regua do setor.");

  const [cliente] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, linha.clienteId));
  if (!cliente?.nichoId) throw new Error("o cliente nao tem um setor.");

  const confirmado = linha.rede === "youtube" ? await confirmarYoutube(linha.handle) : await confirmarInstagram(linha.handle);
  if (!confirmado) throw new Error("o perfil nao esta mais disponivel na rede.");

  const contaId = await upsertConta(
    {
      plataforma: confirmado.plataforma as Plataforma,
      handle: confirmado.handle,
      nome: confirmado.nome,
      url: confirmado.url,
      seguidores: confirmado.seguidores,
      pais: confirmado.pais,
    },
    cliente.nichoId,
  );
  await db().update(contas).set({ origem: "indicada", vigiada: true }).where(eq(contas.id, contaId));
  for (const video of confirmado.videosParaGravar) {
    await upsertVideo(video, contaId, cliente.nichoId);
  }
  await db().update(perfisAnalisados).set({ viraDoSetorEm: new Date() }).where(eq(perfisAnalisados.id, perfilAnalisadoId));

  return { contaId };
}
