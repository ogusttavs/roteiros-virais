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
};

export async function upsertConta(conta: ContaParaGravar, nichoId: number): Promise<number> {
  const [linha] = await db()
    .insert(contas)
    .values({ ...conta, nichoId })
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
  const [linha] = await db()
    .insert(videos)
    .values({ ...video, contaId, nichoId, audio, origem, semDono: contaId === null, execucaoId })
    .onConflictDoUpdate({
      target: [videos.plataforma, videos.idExterno],
      set: {
        views: video.views,
        likes: video.likes,
        comentarios: video.comentarios,
        // Uma recoleta cujo ator nao devolveu audio nao pode apagar o audio
        // ja gravado numa coleta anterior (revisao da etapa 6, parte 2).
        audio: sql`coalesce(${sql.param(audio, videos.audio)}, ${videos.audio})`,
        atualizadoEm: new Date(),
      },
    })
    .returning({ inserido: sql<boolean>`(xmax = 0)` });

  return linha.inserido ? "novo" : "atualizado";
}
