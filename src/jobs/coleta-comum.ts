/**
 * Upsert compartilhado entre as coletas (YouTube, TikTok, Instagram): mesma
 * tabela `contas` e `videos`, mesma chave de conflito. Extraido na etapa 6,
 * parte 2, para `coleta-youtube.ts` e `coleta-apify.ts` nao duplicarem a
 * mesma logica.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { contas, videos, type Plataforma, type VideoAudio } from "@/db/schema";

export type ContaParaGravar = {
  plataforma: Plataforma;
  handle: string;
  nome: string | null;
  url: string | null;
  seguidores: number | null;
  /** So o YouTube preenche hoje, pelo `country` do canal (V2b, item 2). */
  pais?: string | null;
};

export type VideoParaGravar = {
  plataforma: Plataforma;
  idExterno: string;
  url: string;
  titulo: string | null;
  descricao: string | null;
  publicadoEm: Date | null;
  duracaoS: number | null;
  views: number;
  likes: number;
  comentarios: number;
  /** So o normalizador da Meta preenche (V2a, item 3); as outras plataformas nunca passam isso. */
  midiaUrl?: string | null;
  /** Detectado por codigo na coleta (V2b, item 2); a extracao em lote sobrescreve depois. */
  idioma?: string | null;
  /**
   * A miniatura do vídeo (V9d, item 0b): YouTube monta por código
   * (`normalizadores/youtube.ts`, sempre presente); Instagram guarda o
   * `thumbnail_url` da Business Discovery, quando vem; TikTok, a capa do
   * Apify, quando vem.
   */
  capaUrl?: string | null;
};

/**
 * Janela em que a url de mídia da Meta ainda vale a pena tentar (V2a, item
 * 3): a Meta não documenta por quanto tempo o link do CDN é válido. 20h dá
 * folga segura entre a leitura de `meta-contas` (03:35) e o uso de
 * `transcrever`/`analisar-visual` (04:00 em diante), mesmo numa execução
 * atrasada, sem arriscar link já vencido.
 */
export const JANELA_MIDIA_URL_MS = 20 * 60 * 60 * 1000;

/** Função pura, para testar sem banco nem relógio de verdade. */
export function midiaUrlFresca(midiaUrlEm: Date | null, agora: Date = new Date()): boolean {
  if (!midiaUrlEm) return false;
  return agora.getTime() - midiaUrlEm.getTime() < JANELA_MIDIA_URL_MS;
}

export async function upsertConta(conta: ContaParaGravar, nichoId: number): Promise<number> {
  const pais = conta.pais ?? null;
  const [linha] = await db()
    .insert(contas)
    .values({ ...conta, pais, nichoId })
    .onConflictDoUpdate({
      target: [contas.plataforma, contas.handle],
      set: {
        nome: conta.nome,
        url: conta.url,
        // Uma recoleta cujo normalizador nao devolveu seguidores (Instagram,
        // ou o YouTube quando a busca em lote de channels.list falhou) nao
        // pode apagar um valor ja gravado numa coleta anterior (mesmo
        // raciocinio do audio em upsertVideo).
        seguidores: sql`coalesce(${sql.param(conta.seguidores, contas.seguidores)}, ${contas.seguidores})`,
        pais: sql`coalesce(${sql.param(pais, contas.pais)}, ${contas.pais})`,
        atualizadoEm: new Date(),
      },
    })
    .returning({ id: contas.id });
  return linha.id;
}

/**
 * Uma so ida ao banco (revisao da etapa 6, parte 1, PROXIMO.md): `xmax = 0`
 * e como o Postgres marca, na linha devolvida por RETURNING, que este
 * comando inseriu a linha em vez de atualiza-la por ON CONFLICT DO UPDATE.
 * Evita o SELECT separado que a parte 1 fazia so para saber se era novo.
 */
export async function upsertVideo(
  video: VideoParaGravar,
  /**
   * `null` para video da Hashtag Search da Meta, que nunca traz a conta
   * dona (E6 parte 3, segunda rodada, item 3): `semDono` sai daqui, nunca
   * um parametro a parte, para as duas coisas nunca poderem divergir.
   */
  contaId: number | null,
  nichoId: number,
  audio: VideoAudio | null = null,
  /** "meta" para video vindo da Business Discovery/Hashtag Search (E6 parte 3, segunda rodada, item 2). */
  origem: "coleta" | "meta" = "coleta",
  /**
   * Execucao de job que trouxe este video (E6 parte 3, terceira rodada,
   * item 5): so entra em `values` (na insercao), nunca em `set` (no ON
   * CONFLICT DO UPDATE), para nunca reescrever a execucao de um video que ja
   * existia antes desta rodada.
   */
  execucaoId: number | null = null,
): Promise<"novo" | "atualizado"> {
  const midiaUrl = video.midiaUrl ?? null;
  /** So marca a hora da leitura quando ha url de verdade (V2a, item 3); sem ela, nao ha nada fresco para marcar. */
  const midiaUrlEm = midiaUrl ? new Date() : null;
  const idioma = video.idioma ?? null;
  const capaUrl = video.capaUrl ?? null;

  const [linha] = await db()
    .insert(videos)
    .values({ ...video, midiaUrl, midiaUrlEm, idioma, capaUrl, contaId, nichoId, audio, origem, semDono: contaId === null, execucaoId })
    .onConflictDoUpdate({
      target: [videos.plataforma, videos.idExterno],
      set: {
        views: video.views,
        likes: video.likes,
        comentarios: video.comentarios,
        // Uma recoleta cujo ator nao devolveu audio nao pode apagar o audio
        // ja gravado numa coleta anterior (revisao da etapa 6, parte 2).
        audio: sql`coalesce(${sql.param(audio, videos.audio)}, ${videos.audio})`,
        // Mesmo raciocinio do audio (V2a, item 3): uma leitura sem media_url
        // (a maioria) nao pode apagar a url fresca de uma leitura anterior;
        // midiaUrlEm segue midiaUrl, nunca atualiza sozinha.
        midiaUrl: sql`coalesce(${sql.param(midiaUrl, videos.midiaUrl)}, ${videos.midiaUrl})`,
        midiaUrlEm: midiaUrl ? sql`${sql.param(midiaUrlEm, videos.midiaUrlEm)}` : sql`${videos.midiaUrlEm}`,
        // Mesmo raciocinio do midiaUrl (V9d, item 0b): uma recoleta sem capa
        // (Instagram sem thumbnail_url desta vez, ou o TikTok ainda suspenso)
        // nao pode apagar a capa ja gravada numa coleta anterior.
        capaUrl: sql`coalesce(${sql.param(capaUrl, videos.capaUrl)}, ${videos.capaUrl})`,
        // Ordem invertida de proposito (V2b, item 2): o idioma que ja esta
        // gravado manda sobre o novo, porque pode ter vindo da extracao em
        // lote (le a transcricao inteira, mais confiavel) e uma recoleta
        // desta funcao so tem a deteccao mais fraca por titulo/descricao;
        // sem isso, toda recoleta noturna reverteria o idioma bom para o
        // palpite fraco de novo.
        idioma: sql`coalesce(${videos.idioma}, ${sql.param(idioma, videos.idioma)})`,
        atualizadoEm: new Date(),
      },
    })
    .returning({ inserido: sql<boolean>`(xmax = 0)` });

  return linha.inserido ? "novo" : "atualizado";
}
