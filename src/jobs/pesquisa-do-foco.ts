/**
 * Job `pesquisa-do-foco` (E61 PR 3, 28/10/2026): a camada pequena de coleta por conta com foco confirmado, para o banco do setor ter vídeo do ASSUNTO da conta e não só do setor.
 *
 * Só fontes sem custo extra: a API do YouTube dentro da cota gratuita (`search.list` por frase, `playlistItems` dos canais de referência, `videos.list`). Nenhuma chamada à Apify (provado em teste).
 * O TikTok pelo `yt-dlp` lê UM vídeo cujo endereço já se conhece, não descobre vídeo (o estudo de 27/10 mediu a listagem de perfil certa 1 vez em 24 e a hashtag não existe), então não entra aqui.
 * A busca por significado do banco entra como porteira: com `focoProvaSuficiente` vídeos do setor já falando do assunto, a conta não gasta busca hoje (só lê os canais de referência).
 *
 * Para cada conta com foco confirmado, em uso e com assinatura em dia (ou só a conta pedida, quando a pessoa acabou de confirmar o foco):
 *  1. as frases e os canais saem do foco UMA vez (`derivarBuscaDoFoco`, modelo barato); só se o foco mudou;
 *  2. cada canal sugerido é conferido na API do YouTube (1 unidade) e só o que existe e não é de outro país é usado;
 *  3. busca por frase (teto de buscas por conta e por dia), lê os últimos vídeos dos canais, junta tudo na vez (teto de vídeos por conta e por dia) e grava no banco do SETOR da conta com as
 *     mesmas regras de sempre: o piso de views, o relativo à conta e a transcrição só do que passa no filtro são do `pontuar` e do `transcrever`, que leem o banco do setor do mesmo jeito.
 * Teto de todas as contas juntas em unidades da cota (`focoUnidadesPorDia`) e a cota diária do YouTube (a mesma da coleta do setor) nunca é passada. O resumo só tem contagens: nenhuma frase de
 * busca de uma conta aparece em lugar onde outra possa ver, e os vídeos guardados não levam marca do que os trouxe.
 */
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { clientes, pesquisaDoFoco, type CanalDoFoco, type PesquisaDoFoco } from "@/db/schema";
import { config, hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { separarMarcasPorAssinatura } from "@/servicos/assinatura-tarefas";
import { focoConfirmado } from "@/servicos/foco-da-conta";
import { normalizarVideoYoutube } from "@/servicos/normalizadores/youtube";
import {
  derivarBuscaDoFoco,
  ErroPesquisaDoFoco,
  gastoDoDia,
  intercalarSemRepetir,
  pesquisaDoFocoDaConta,
  provasDoFocoNoBanco,
  somarAoGastoDoDia,
  unidadesDoFocoHoje,
} from "@/servicos/pesquisa-do-foco";

import { upsertConta, upsertVideo } from "./coleta-comum";
import { consumoDeHoje, LIMITE_DIARIO_UNIDADES, registrarConsumo } from "./coleta-youtube";
import { DIAS_DE_USO_PARA_TEMA } from "./temas-do-dia";
import * as youtubeApi from "./youtube-api";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Quantos dos últimos vídeos de um canal de referência entram na fila de vídeos do dia (os mais recentes). */
const VIDEOS_POR_CANAL = 10;

/** O que o job usa da API do YouTube; os testes trocam por uma de mentira (sem rede). */
export type ApiYoutubeDoFoco = Pick<typeof youtubeApi, "buscarPorTermo" | "buscarVideosPorId" | "buscarCanal" | "buscarUploadsDoCanal" | "buscarCanaisPorId">;

export type OpcoesDaPesquisaDoFoco = {
  /** Só esta conta (a pessoa acabou de confirmar ou mudar o foco): sem o critério de uso. */
  clienteId?: number;
  api?: ApiYoutubeDoFoco;
  agora?: Date;
  /** Os testes dizem que há chave sem pôr uma de verdade no ambiente. */
  temChave?: boolean;
};

type ContaComFoco = { id: number; nichoId: number; nome: string; foco: string };

/** As contas que a pesquisa do foco atende hoje: ativas, com ramo, foco confirmado, assinatura em dia e em uso (a pedida pela pessoa dispensa o uso). */
export async function contasParaPesquisarOFoco(opcoes: { clienteId?: number; agora: Date }): Promise<ContaComFoco[]> {
  const condicoes = [eq(clientes.ativo, true), isNotNull(clientes.nichoId), isNotNull(clientes.foco)];
  if (opcoes.clienteId !== undefined) condicoes.push(eq(clientes.id, opcoes.clienteId));
  const linhas = await db()
    .select({
      id: clientes.id,
      nichoId: clientes.nichoId,
      nome: clientes.nome,
      foco: clientes.foco,
      focoOrigem: clientes.focoOrigem,
      focoConfirmadoEm: clientes.focoConfirmadoEm,
      ultimoAcessoEm: clientes.ultimoAcessoEm,
    })
    .from(clientes)
    .where(and(...condicoes))
    .orderBy(clientes.id);
  const desde = opcoes.agora.getTime() - DIAS_DE_USO_PARA_TEMA * DIA_MS;
  const comFoco = linhas.flatMap((c) => {
    const foco = focoConfirmado(c);
    if (!foco || c.nichoId === null) return [];
    if (opcoes.clienteId === undefined && !(c.ultimoAcessoEm && c.ultimoAcessoEm.getTime() >= desde)) return [];
    return [{ id: c.id, nichoId: c.nichoId, nome: c.nome, foco }];
  });
  if (comFoco.length === 0) return [];
  // A conta sem assinatura que vale não gasta cota nem IA com a pesquisa dela.
  const { liberadas } = await separarMarcasPorAssinatura(comFoco.map((c) => c.id), { agora: opcoes.agora });
  return comFoco.filter((c) => liberadas.has(c.id));
}

export type ResumoDaPesquisaDoFoco = {
  desligada?: boolean;
  semChave?: boolean;
  contas: number;
  derivadas: number;
  canaisConferidos: number;
  buscas: number;
  buscasPuladasPorProva: number;
  unidades: number;
  videosNovos: number;
  videosAtualizados: number;
  /** Vídeos que a conta pesquisou e o código deixou de fora (outro idioma ou longo demais para o produto). */
  videosDeFora: number;
  paradoPorTeto?: string;
  falhas: number;
  erros: string[];
};

function resumoVazio(): ResumoDaPesquisaDoFoco {
  return { contas: 0, derivadas: 0, canaisConferidos: 0, buscas: 0, buscasPuladasPorProva: 0, unidades: 0, videosNovos: 0, videosAtualizados: 0, videosDeFora: 0, falhas: 0, erros: [] };
}

export async function rodarPesquisaDoFoco(opcoes: OpcoesDaPesquisaDoFoco = {}): Promise<Record<string, unknown>> {
  const agora = opcoes.agora ?? new Date();
  const resumo = resumoVazio();
  if (!config.regras.focoPesquisaLigada) return { ...resumo, desligada: true };
  const api: ApiYoutubeDoFoco = opcoes.api ?? youtubeApi;
  const temChave = opcoes.temChave ?? config.coleta.youtubeKey !== "";

  const contas = await contasParaPesquisarOFoco({ clienteId: opcoes.clienteId, agora });
  resumo.contas = contas.length;
  if (contas.length === 0) return { ...resumo };

  const hoje = hojeISO(agora);
  const cotaDoYoutubeHoje = { usada: await consumoDeHoje() };
  const focoHoje = { usado: await unidadesDoFocoHoje(hoje) };
  /** Cabe `custo` unidades: dentro do teto das contas juntas e da cota diária do YouTube (a mesma da coleta do setor). */
  const cabe = (custo: number) => focoHoje.usado + custo <= config.regras.focoUnidadesPorDia && cotaDoYoutubeHoje.usada + custo <= LIMITE_DIARIO_UNIDADES;

  for (const conta of contas) {
    try {
      await pesquisarOFocoDaConta(conta, { api, temChave, agora, hoje, resumo, cabe, cotaDoYoutubeHoje, focoHoje });
    } catch (erro) {
      resumo.falhas += 1;
      // Só o id da conta no erro: o texto do foco e as frases nunca vão para o resumo.
      resumo.erros.push(`conta ${conta.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
      logger.warn({ err: erro, clienteId: conta.id }, "a pesquisa do foco falhou nesta conta");
    }
  }
  if (!temChave) resumo.semChave = true;
  return { ...resumo };
}

type Contexto = {
  api: ApiYoutubeDoFoco;
  temChave: boolean;
  agora: Date;
  hoje: string;
  resumo: ResumoDaPesquisaDoFoco;
  cabe: (custo: number) => boolean;
  cotaDoYoutubeHoje: { usada: number };
  focoHoje: { usado: number };
};

async function pesquisarOFocoDaConta(conta: ContaComFoco, ctx: Contexto): Promise<void> {
  const { api, resumo } = ctx;

  // 1. As frases e os canais: uma vez por foco.
  let pesquisa: PesquisaDoFoco | null = await pesquisaDoFocoDaConta(conta.id, conta.foco);
  if (!pesquisa) {
    try {
      pesquisa = await derivarBuscaDoFoco(conta.id, conta.foco, ctx.agora);
      resumo.derivadas += 1;
    } catch (erro) {
      if (erro instanceof ErroPesquisaDoFoco) {
        resumo.falhas += 1;
        resumo.erros.push(`conta ${conta.id}: ${erro.motivo}`);
        return;
      }
      throw erro;
    }
  }
  if (!ctx.temChave) return;

  const gasto = await gastoDoDia(conta.id, ctx.hoje);
  /** Conta antes de chamar: a API desconta a unidade mesmo quando a chamada falha (mesmo cuidado da coleta do setor). */
  const gastar = async (unidades: number, buscas = 0): Promise<void> => {
    ctx.cotaDoYoutubeHoje.usada += unidades;
    ctx.focoHoje.usado += unidades;
    resumo.unidades += unidades;
    gasto.unidades += unidades;
    gasto.buscas += buscas;
    await registrarConsumo(unidades);
    await somarAoGastoDoDia(conta.id, { unidades, buscas }, ctx.hoje);
  };

  // 2. Os canais sugeridos são conferidos na API antes de qualquer uso (nome lembrado de memória pode estar errado).
  if (!pesquisa.conferidosEm) {
    const confirmados: CanalDoFoco[] = [];
    for (const handle of pesquisa.canaisSugeridos.slice(0, config.regras.focoCanaisPorConta)) {
      if (!ctx.cabe(youtubeApi.CUSTO_LISTA)) break;
      try {
        await gastar(youtubeApi.CUSTO_LISTA);
        const resposta = await api.buscarCanal(handle);
        const canal = resposta.items?.[0];
        // Um canal de outro país não é referência para um foco brasileiro; sem país informado, o canal passa.
        if (!canal || !canal.contentDetails?.relatedPlaylists?.uploads) continue;
        if (canal.snippet.country && canal.snippet.country !== "BR") continue;
        confirmados.push({ handle, canalId: canal.id, nome: canal.snippet.title, uploadsId: canal.contentDetails.relatedPlaylists.uploads });
      } catch (erro) {
        resumo.erros.push(`conta ${conta.id}: canal nao conferido (${erro instanceof Error ? erro.message.slice(0, 120) : "erro"})`);
      }
    }
    resumo.canaisConferidos += confirmados.length;
    const [atualizada] = await db()
      .update(pesquisaDoFoco)
      .set({ canais: confirmados, conferidosEm: ctx.agora })
      .where(and(eq(pesquisaDoFoco.clienteId, conta.id), eq(pesquisaDoFoco.focoHash, pesquisa.focoHash)))
      .returning();
    if (atualizada) pesquisa = atualizada;
  }

  // 3. A busca por frase, só se o setor ainda não tem prova do assunto e dentro do teto de buscas do dia.
  const idsDasBuscas: string[][] = [];
  const buscasRestantes = Math.max(0, config.regras.focoBuscasPorContaPorDia - gasto.buscas);
  if (buscasRestantes > 0) {
    const provas = await provasDoFocoNoBanco(conta.nichoId, pesquisa.termos, ctx.agora);
    if (provas >= config.regras.focoProvaSuficiente) {
      resumo.buscasPuladasPorProva += 1;
    } else {
      const publicadoApos = new Date(ctx.agora.getTime() - 7 * DIA_MS);
      for (const termo of pesquisa.termos.slice(0, buscasRestantes)) {
        if (!ctx.cabe(youtubeApi.CUSTO_SEARCH)) {
          resumo.paradoPorTeto = "a cota da pesquisa do foco de hoje acabou";
          break;
        }
        try {
          await gastar(youtubeApi.CUSTO_SEARCH, 1);
          resumo.buscas += 1;
          const resposta = await api.buscarPorTermo(termo, publicadoApos);
          idsDasBuscas.push((resposta.items ?? []).flatMap((item) => (item.id.videoId ? [item.id.videoId] : [])));
        } catch (erro) {
          resumo.erros.push(`conta ${conta.id}: busca falhou (${erro instanceof Error ? erro.message.slice(0, 120) : "erro"})`);
        }
      }
    }
  }

  // 4. Os últimos vídeos dos canais de referência (1 unidade cada).
  const idsDosCanais: string[][] = [];
  for (const canal of pesquisa.canais.slice(0, config.regras.focoCanaisPorConta)) {
    if (!ctx.cabe(youtubeApi.CUSTO_LISTA)) break;
    try {
      await gastar(youtubeApi.CUSTO_LISTA);
      const uploads = await api.buscarUploadsDoCanal(canal.uploadsId);
      idsDosCanais.push((uploads.items ?? []).slice(0, VIDEOS_POR_CANAL).map((item) => item.snippet.resourceId.videoId));
    } catch (erro) {
      resumo.erros.push(`conta ${conta.id}: canal de referencia nao leu (${erro instanceof Error ? erro.message.slice(0, 120) : "erro"})`);
    }
  }

  // 5. Os vídeos do dia, no teto por conta, e a gravação no banco do setor.
  const vagas = Math.max(0, config.regras.focoVideosPorContaPorDia - gasto.videos);
  const ids = intercalarSemRepetir([...idsDasBuscas, ...idsDosCanais], vagas);
  let guardados = 0;
  for (let i = 0; i < ids.length; i += 50) {
    if (!ctx.cabe(youtubeApi.CUSTO_LISTA)) break;
    const lote = ids.slice(i, i + 50);
    try {
      await gastar(youtubeApi.CUSTO_LISTA);
      const itens = (await api.buscarVideosPorId(lote)).items ?? [];
      const seguidoresPorCanal = new Map<string, number | null>();
      const paisPorCanal = new Map<string, string | null>();
      const canaisDoLote = [...new Set(itens.map((item) => item.snippet.channelId))];
      if (canaisDoLote.length > 0 && ctx.cabe(youtubeApi.CUSTO_LISTA)) {
        try {
          await gastar(youtubeApi.CUSTO_LISTA);
          for (const canal of (await api.buscarCanaisPorId(canaisDoLote)).items ?? []) {
            seguidoresPorCanal.set(canal.id, canal.statistics?.subscriberCount ? Number(canal.statistics.subscriberCount) : null);
            paisPorCanal.set(canal.id, canal.snippet.country ?? null);
          }
        } catch {
          // Sem seguidores desta vez: `upsertConta` guarda o que já se sabia.
        }
      }
      for (const item of itens) {
        const { video, conta: donoDoVideo } = normalizarVideoYoutube(item);
        // Fora do produto: vídeo em outro idioma (o foco é de uma conta brasileira) e vídeo longo (o produto é vídeo curto, o mesmo teto da referência).
        const longo = video.duracaoS !== null && video.duracaoS > config.regras.tetoDuracaoReferenciaS;
        if (longo || video.idioma === "en" || video.idioma === "es" || video.idioma === "outro") {
          resumo.videosDeFora += 1;
          continue;
        }
        const contaId = await upsertConta(
          { ...donoDoVideo, seguidores: seguidoresPorCanal.get(item.snippet.channelId) ?? null, pais: paisPorCanal.get(item.snippet.channelId) ?? null },
          conta.nichoId,
        );
        const resultado = await upsertVideo(video, contaId, conta.nichoId);
        guardados += 1;
        if (resultado === "novo") resumo.videosNovos += 1;
        else resumo.videosAtualizados += 1;
      }
    } catch (erro) {
      resumo.erros.push(`conta ${conta.id}: videos.list falhou (${erro instanceof Error ? erro.message.slice(0, 120) : "erro"})`);
    }
  }
  if (guardados > 0) await somarAoGastoDoDia(conta.id, { videos: guardados }, ctx.hoje);
  await db().update(pesquisaDoFoco).set({ ultimaColetaEm: ctx.agora }).where(eq(pesquisaDoFoco.clienteId, conta.id));
}
