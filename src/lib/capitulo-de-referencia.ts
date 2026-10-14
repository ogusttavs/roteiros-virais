/**
 * E52 (PR 4c): "o capítulo que interessa" de um vídeo longo de referência, só com o que o banco tem. A leitura da estrutura (`videos.analise_longa`) diz o que o título promete e em que segundo
 * a abertura entrega (`abertura.entregaAteS`); o capítulo que contém esse segundo é o que interessa. Sem leitura, sem capítulos lidos ou com `entregaAteS` nulo (o vídeo não entrega) não há
 * capítulo: a tela mostra "Ver desde o começo" e nunca inventa um. `ondeSairia` (a leitura do modelo sobre retenção) não entra: não é número da plataforma.
 */
import type { AnaliseVideoLonga } from "@/db/schema";

export type CapituloQueInteressa = { inicioS: number; fimS: number; nome: string; promessa: string };

export function capituloQueInteressa(analise: AnaliseVideoLonga | null | undefined, duracaoS: number): CapituloQueInteressa | null {
  if (!analise) return null;
  const entrega = analise.abertura?.entregaAteS;
  if (entrega === null || entrega === undefined || !Number.isFinite(entrega) || entrega < 0 || entrega > duracaoS) return null;
  const capitulos = [...(analise.capitulos ?? [])].filter((c) => Number.isFinite(c.inicioS) && c.inicioS >= 0 && c.inicioS < duracaoS).sort((a, b) => a.inicioS - b.inicioS);
  if (capitulos.length === 0) return null;
  // O capítulo que contém o segundo: o último que começou até ele. Se o primeiro começa depois (a lista não abre em 0:00), o segundo ainda não é de nenhum capítulo.
  let indice = -1;
  capitulos.forEach((c, i) => {
    if (c.inicioS <= entrega) indice = i;
  });
  if (indice < 0) return null;
  const capitulo = capitulos[indice];
  const proximo = capitulos[indice + 1];
  const nome = capitulo.nome.replace(/\s+/g, " ").trim();
  const promessa = (analise.abertura.promessa ?? "").replace(/\s+/g, " ").trim();
  if (!nome) return null;
  return { inicioS: capitulo.inicioS, fimS: proximo ? proximo.inicioS : duracaoS, nome, promessa };
}
