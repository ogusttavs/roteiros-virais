/**
 * Audio da semana (etapa 9, decisao 3 do `PROXIMO.md`): entre os videos
 * fora da curva do nicho na ultima semana, os tres audios que mais se
 * repetem (TikTok e Instagram tem `videos.audio`; YouTube nao expoe isso
 * pela API, fica de fora sem erro). Criterio fixo: o mais usado entre os
 * que renderam (ja filtrados por fora da curva por quem chama), nao o mais
 * usado em geral. Sem I/O, para testar com fixture sem banco.
 */
import type { VideoAudio } from "@/db/schema";

export type VideoComAudio = {
  id: number;
  audio: VideoAudio | null;
};

export type AudioContado = {
  nome: string | null;
  autor: string | null;
  contagem: number;
  videoExemploId: number;
};

const TOP = 3;

export function contarAudiosDaSemana(videos: VideoComAudio[]): AudioContado[] {
  const porChave = new Map<string, AudioContado>();

  for (const v of videos) {
    const audio = v.audio;
    if (!audio || (!audio.id && !audio.nome)) continue;

    const chave = audio.id ?? `nome:${audio.nome}`;
    const existente = porChave.get(chave);
    if (existente) {
      existente.contagem += 1;
    } else {
      porChave.set(chave, {
        nome: audio.nome ?? null,
        autor: audio.autor ?? null,
        contagem: 1,
        videoExemploId: v.id,
      });
    }
  }

  return [...porChave.values()]
    .sort((a, b) => b.contagem - a.contagem || a.videoExemploId - b.videoExemploId)
    .slice(0, TOP);
}
