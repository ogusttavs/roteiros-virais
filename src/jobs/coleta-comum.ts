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
      set: { nome: conta.nome, url: conta.url, atualizadoEm: new Date() },
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
  contaId: number,
  nichoId: number,
  audio: VideoAudio | null = null,
): Promise<"novo" | "atualizado"> {
  const [linha] = await db()
    .insert(videos)
    .values({ ...video, contaId, nichoId, audio, origem: "coleta" })
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
