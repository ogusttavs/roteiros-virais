/**
 * Job `filtrarNoticias` (fila `filtrar-noticias`, fix de 22/10/2026, Notícias): separa, entre as notícias que a coleta trouxe, as que importam para quem toca negócio no ramo, e guarda a foto
 * da matéria das que a tela vai mostrar. Dois jeitos de rodar:
 *
 *  - com `{ nichoId }`: a marca acabou de chegar naquele ramo (briefing terminado, conta criada pelo admin, ramo trocado, tela de Notícias aberta). Roda já, só para ele.
 *  - sem nada: depois de cada coleta de notícias (06:00 e 14:00) para os ramos com marca ativa, sem depender do `temas-do-dia`. "Ativa" é a mesma economia de 06/10/2026 (o filtro é a única chamada
 *    de IA deste job, barata, mas não custa nada onde ninguém lê): ramo de marca que gerou roteiro, abriu o aplicativo ou foi criada nos últimos 3 dias.
 *
 * O que entra no filtro está em `servicos/filtro-de-noticias.ts` (só notícia publicada nos últimos 7 dias). A foto fica com `foto-da-materia.ts`: só para as relevantes que a capa ainda mostra, sem
 * foto do veículo no feed, até `FOTOS_POR_RAMO_POR_RODADA` por ramo e `ORCAMENTO_DE_FOTOS_MS` no total; a que não deu certo volta uma vez; o que passa de 14 dias é apagado.
 */
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientes, imagensNoticia, nichos, noticias, ramosDaConta } from "@/db/schema";
import { filtrarNoticiasDoRamo, type RamoParaOFiltro } from "@/servicos/filtro-de-noticias";
import { creditoDaFoto } from "@/servicos/noticias-assuntos";
import { DIAS_DA_CAPA } from "@/servicos/noticias-do-dia";

import { fotoDaMateria, type ResultadoDaFoto, type TransporteDaFoto } from "./foto-da-materia";
import { DIAS_DE_USO_PARA_TEMA, setoresEmUso } from "./temas-do-dia";

const DIA_MS = 24 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000;

/** Quantas matérias, no máximo, um ramo tem a foto buscada por rodada (a rede é a parte lenta e a que mais falha). */
export const FOTOS_POR_RAMO_POR_RODADA = 12;
/** O tempo total que a busca de fotos pode levar numa rodada, somando todos os ramos. */
export const ORCAMENTO_DE_FOTOS_MS = 8 * 60 * 1000;
/** Pausa entre uma matéria e a seguinte, para o Google News e os veículos não verem rajada. */
const PAUSA_ENTRE_MATERIAS_MS = 400;
/** Uma foto que a rede não entregou volta depois deste tempo, uma vez só. */
const ESPERA_PARA_TENTAR_DE_NOVO_MS = 3 * HORA_MS;
const TENTATIVAS_MAXIMAS = 2;
/** A foto guardada some depois disto (a tela mostra no máximo 3 dias). */
export const DIAS_DA_FOTO_GUARDADA = 14;

export type DependenciasDoFiltro = {
  agora?: Date;
  /** Substitui o caminho da foto (testes). Sem isto, a rede de verdade. */
  foto?: (linkDaNoticia: string) => Promise<ResultadoDaFoto>;
  transporte?: TransporteDaFoto;
  esperar?: (ms: number) => Promise<void>;
};

/** Os ramos que o filtro cobre na rodada de depois da coleta. Exportada para o teste. */
export async function ramosParaOFiltro(agora: Date = new Date()): Promise<RamoParaOFiltro[]> {
  const desde = new Date(agora.getTime() - DIAS_DE_USO_PARA_TEMA * DIA_MS);
  const ids = new Set<number>(await setoresEmUso(agora));

  // Marcas ativas que abriram o aplicativo ou chegaram nos últimos dias, mesmo sem roteiro ainda.
  const recentes = await db()
    .select({ id: clientes.id, nichoId: clientes.nichoId })
    .from(clientes)
    .where(and(eq(clientes.ativo, true), or(gte(clientes.ultimoAcessoEm, desde), gte(clientes.criadoEm, desde))));
  for (const marca of recentes) if (marca.nichoId) ids.add(marca.nichoId);
  if (recentes.length > 0) {
    const alternativos = await db()
      .selectDistinct({ nichoId: ramosDaConta.nichoId })
      .from(ramosDaConta)
      .where(inArray(ramosDaConta.clienteId, recentes.map((m) => m.id)));
    for (const l of alternativos) ids.add(l.nichoId);
  }
  if (ids.size === 0) return [];

  return db()
    .select({ id: nichos.id, nome: nichos.nome, termos: nichos.termos })
    .from(nichos)
    .where(and(eq(nichos.ativo, true), inArray(nichos.id, [...ids])));
}

type AlvoDeFoto = { id: number; url: string; fonte: string | null };

/** As relevantes que a capa ainda mostra, sem foto do veículo no feed e sem foto nossa (ou com tentativa que vale refazer), as mais recentes primeiro. */
async function materiasSemFoto(nichoId: number, agora: Date, limite: number): Promise<AlvoDeFoto[]> {
  const mostradasDesde = new Date(agora.getTime() - DIAS_DA_CAPA * DIA_MS);
  const podeTentarDeNovo = new Date(agora.getTime() - ESPERA_PARA_TENTAR_DE_NOVO_MS);
  return db()
    .select({ id: noticias.id, url: noticias.url, fonte: noticias.fonte })
    .from(noticias)
    .leftJoin(imagensNoticia, eq(imagensNoticia.noticiaId, noticias.id))
    .where(
      and(
        eq(noticias.nichoId, nichoId),
        eq(noticias.relevante, true),
        isNull(noticias.imagemUrl),
        gte(noticias.publicadoEm, mostradasDesde),
        or(
          isNull(imagensNoticia.noticiaId),
          and(eq(imagensNoticia.situacao, "sem_foto"), lt(imagensNoticia.tentativas, TENTATIVAS_MAXIMAS), lt(imagensNoticia.tentouEm, podeTentarDeNovo)),
        ),
      ),
    )
    .orderBy(sql`${noticias.publicadoEm} desc`, sql`${noticias.id} desc`)
    .limit(limite);
}

async function gravarResultado(alvo: AlvoDeFoto, resultado: ResultadoDaFoto): Promise<void> {
  if (resultado.situacao === "guardada") {
    const valores = { situacao: "guardada" as const, tipo: resultado.tipo, bytes: Buffer.from(resultado.bytes), origem: resultado.origem.slice(0, 2048), tentouEm: new Date() };
    await db()
      .insert(imagensNoticia)
      .values({ noticiaId: alvo.id, ...valores, tentativas: 1 })
      .onConflictDoUpdate({ target: imagensNoticia.noticiaId, set: { ...valores, tentativas: sql`${imagensNoticia.tentativas} + 1` } });
    let veiculo = alvo.fonte;
    if (!veiculo) {
      try {
        veiculo = new URL(resultado.origem).hostname.replace(/^www\./, "");
      } catch {
        veiculo = null;
      }
    }
    if (veiculo) await db().update(noticias).set({ imagemCredito: creditoDaFoto(veiculo) }).where(eq(noticias.id, alvo.id));
    return;
  }
  // Sem foto que sirva: se foi a rede, a próxima rodada tenta mais uma vez; se a página abriu e não tem foto, é definitivo (conta como a última tentativa).
  const tentativasDepois = resultado.passageiro ? 1 : TENTATIVAS_MAXIMAS;
  await db()
    .insert(imagensNoticia)
    .values({ noticiaId: alvo.id, situacao: "sem_foto", tentativas: tentativasDepois, origem: resultado.motivo })
    .onConflictDoUpdate({
      target: imagensNoticia.noticiaId,
      set: {
        situacao: "sem_foto",
        tipo: null,
        bytes: null,
        origem: resultado.motivo,
        tentouEm: new Date(),
        tentativas: resultado.passageiro ? sql`${imagensNoticia.tentativas} + 1` : TENTATIVAS_MAXIMAS,
      },
    });
}

const esperarDeVerdade = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type ResumoDaFotoDoRamo = { tentadas: number; guardadas: number; semFoto: number; passouDoOrcamento?: boolean };

async function buscarFotosDoRamo(nichoId: number, agora: Date, termina: number, deps: DependenciasDoFiltro): Promise<ResumoDaFotoDoRamo> {
  const resumo: ResumoDaFotoDoRamo = { tentadas: 0, guardadas: 0, semFoto: 0 };
  const buscar = deps.foto ?? ((link: string) => fotoDaMateria(link, deps.transporte));
  const esperar = deps.esperar ?? esperarDeVerdade;
  for (const alvo of await materiasSemFoto(nichoId, agora, FOTOS_POR_RAMO_POR_RODADA)) {
    if (Date.now() >= termina) {
      resumo.passouDoOrcamento = true;
      break;
    }
    if (resumo.tentadas > 0) await esperar(PAUSA_ENTRE_MATERIAS_MS);
    resumo.tentadas += 1;
    let resultado: ResultadoDaFoto;
    try {
      resultado = await buscar(alvo.url);
    } catch {
      resultado = { situacao: "sem_foto", motivo: "erro_inesperado", passageiro: true };
    }
    await gravarResultado(alvo, resultado);
    if (resultado.situacao === "guardada") resumo.guardadas += 1;
    else resumo.semFoto += 1;
  }
  return resumo;
}

/** Apaga as fotos guardadas há mais de 14 dias. */
export async function apagarFotosVelhas(agora: Date = new Date()): Promise<number> {
  const apagadas = await db()
    .delete(imagensNoticia)
    .where(lt(imagensNoticia.criadoEm, new Date(agora.getTime() - DIAS_DA_FOTO_GUARDADA * DIA_MS)))
    .returning({ id: imagensNoticia.noticiaId });
  return apagadas.length;
}

export async function rodarFiltroDeNoticias(nichoId?: number, deps: DependenciasDoFiltro = {}): Promise<Record<string, unknown>> {
  const agora = deps.agora ?? new Date();
  const ramos: RamoParaOFiltro[] =
    nichoId !== undefined
      ? await db().select({ id: nichos.id, nome: nichos.nome, termos: nichos.termos }).from(nichos).where(and(eq(nichos.id, nichoId), eq(nichos.ativo, true)))
      : await ramosParaOFiltro(agora);

  const termina = Date.now() + ORCAMENTO_DE_FOTOS_MS;
  let lotes = 0;
  let candidatas = 0;
  let relevantes = 0;
  let fotosTentadas = 0;
  let fotosGuardadas = 0;
  let fotosSemFoto = 0;
  let passouDoOrcamento = false;
  const erros: string[] = [];

  for (const ramo of ramos) {
    try {
      const filtro = await filtrarNoticiasDoRamo(ramo, { agora });
      lotes += filtro.lotes;
      candidatas += filtro.candidatas;
      relevantes += filtro.relevantes;
    } catch (erro) {
      erros.push(`filtro do ramo ${ramo.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
    try {
      const fotos = await buscarFotosDoRamo(ramo.id, agora, termina, deps);
      fotosTentadas += fotos.tentadas;
      fotosGuardadas += fotos.guardadas;
      fotosSemFoto += fotos.semFoto;
      if (fotos.passouDoOrcamento) passouDoOrcamento = true;
    } catch (erro) {
      erros.push(`fotos do ramo ${ramo.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  let fotosApagadas = 0;
  try {
    fotosApagadas = await apagarFotosVelhas(agora);
  } catch (erro) {
    erros.push(`limpeza das fotos: ${erro instanceof Error ? erro.message : String(erro)}`);
  }

  // Tudo falhou: o registro da execução precisa dizer erro, não "ok" com zero.
  if (ramos.length > 0 && erros.length >= ramos.length * 2) throw new Error(`o filtro das noticias falhou em tudo: ${erros.slice(0, 3).join("; ")}`);

  return {
    ramos: ramos.length,
    lotes,
    candidatas,
    relevantes,
    fotos: { tentadas: fotosTentadas, guardadas: fotosGuardadas, semFoto: fotosSemFoto, passouDoOrcamento: passouDoOrcamento || undefined },
    fotosApagadas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
