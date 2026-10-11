import { z } from "zod";

import { TIPOS_ABERTURA } from "@/db/schema";

import type { EsforcoIA, NivelIA } from "../tipos";

import { definicoesTipoAbertura } from "./definicoesTipoAbertura";

/**
 * E52 (PR 2), a leitura de um vídeo longo do YouTube: a estrutura de um vídeo de alguns minutos (a abertura que promete, os capítulos, os laços abertos e pagos, onde a pessoa
 * sairia, o fechamento), que a ficha de um curto (`extrairVideo`) não descreve. Modelo barato, uma chamada por vídeo, só para os poucos longos da semana (`longosParaLer`).
 *
 * O texto entra com marcas de tempo APROXIMADAS (a posição no texto, na proporção da duração; `servicos/leitura-dos-longos.ts`): a transcrição não traz o tempo de cada fala. Quando o
 * dono escreveu a lista de capítulos na descrição, os capítulos e os tempos dela entram na entrada como dados, e o código (não o modelo) é quem os mantém na saída.
 *
 * A leitura é do modelo, nunca número da plataforma: retenção de verdade é dado privado do dono do vídeo, e `ondeSairia` é onde uma pessoa provavelmente sairia, não onde saiu.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

/** Mesmo texto-base de `extrairVideo.ts`. */
const LEMBRETE_ACENTUACAO =
  "Escreva a leitura inteira com a acentuação correta do português (você, não, já, também, é, está), mesmo que a transcrição esteja em outro idioma ou sem acento.";

/** Quanto do texto da descrição entra (o começo dela: o resto é link e rede social). */
const MAX_CARACTERES_DESCRICAO = 1200;

const tempo = z.number();

const schemaBruto = z.object({
  assunto: z.string(),
  abertura: z.object({
    /** O que o título e os primeiros segundos prometem. */
    promessa: z.string(),
    /** Até que segundo a abertura entrega o que prometeu; nulo quando o vídeo nunca entrega. */
    entregaAteS: tempo.nullable(),
    tipo: z.enum(TIPOS_ABERTURA).catch("outro"),
  }),
  capitulos: z.array(
    z.object({
      inicioS: tempo,
      nome: z.string(),
      oQueFaz: z.string(),
      gancho: z.string().nullable(),
    }),
  ),
  lacos: z.array(
    z.object({
      abertoEmS: tempo,
      pagoEmS: tempo.nullable(),
      oQue: z.string(),
    }),
  ),
  ondeSairia: z.array(
    z.object({
      segundo: tempo,
      porQue: z.string(),
    }),
  ),
  fechamento: z.object({
    oQueFaz: z.string(),
    apontaParaProximoVideo: z.boolean(),
  }),
  porQueFuncionou: z.string(),
});

export const schema = schemaBruto;

export type SaidaExtrairVideoLongo = z.infer<typeof schemaBruto>;

export function montarSistemaEstavel(): string {
  return `Você lê a transcrição de um vídeo LONGO do YouTube (de alguns minutos até uns quarenta) que ficou
acima do normal da conta num nicho de dono de pequeno negócio, e descreve a ESTRUTURA dele para quem vai
escrever um roteiro longo parecido. Não é um resumo do assunto: é como o vídeo se sustenta por minutos.

Como os tempos funcionam: a transcrição vem com marcas entre colchetes, como [3:20]. Elas são APROXIMADAS
(a posição no texto, na proporção da duração do vídeo), não o tempo exato da fala. Use-as para dizer onde
as coisas acontecem, em segundos, sem fingir precisão. Quando a entrada trouxer a lista de capítulos que
o dono escreveu na descrição, ela está certa: use os mesmos capítulos, com os mesmos tempos e os nomes
dele, e descreva o que cada um faz.

O que preencher:
- assunto: o tema do vídeo em poucas palavras.
- abertura:
  - promessa: o que o título e o começo prometem a quem assiste, em uma frase.
  - entregaAteS: até que segundo a abertura entrega o que prometeu (o primeiro momento em que a pessoa
    já recebeu algo do que foi prometido); null quando o vídeo nunca entrega.
  - tipo: como o vídeo começa, um destes oito tipos:

${definicoesTipoAbertura()}

- capitulos: na ordem. Quando a entrada traz a lista do dono, um capítulo seu para cada capítulo dele
  (todos, com o mesmo início); sem a lista, de 3 a 12 capítulos que você propõe. Cada um com inicioS
  (segundo em que começa; o primeiro é 0), nome (curto, como o dono ou o assunto chamaria), oQueFaz (o que
  o capítulo entrega, em uma frase) e gancho: o que segura a pessoa até o próximo capítulo (uma pergunta
  deixada aberta, uma promessa, uma virada), em uma frase; null no último capítulo.
- lacos: o que o vídeo promete mais adiante e onde paga ("depois eu mostro o erro que mais custa caro").
  abertoEmS é onde prometeu, pagoEmS onde pagou, null se nunca pagou. Pode ser uma lista vazia.
- ondeSairia: de 0 a 3 pontos onde uma pessoa provavelmente sairia (uma explicação longa sem nada novo,
  uma repetição, uma tangente), com o segundo e o motivo. É a sua leitura do texto, não um dado da
  plataforma: se não vê ponto nenhum, devolva a lista vazia.
- fechamento: oQueFaz (o que o final entrega) e apontaParaProximoVideo (true só quando ele manda a pessoa
  para outro vídeo específico, uma série ou uma playlist).
- porQueFuncionou: sua leitura, em uma frase, de por que a estrutura segurou a atenção.

Não invente: o que não está na transcrição não entra. Sem travessão, sem emoji.

Escreva em português do Brasil, com acentuação correta.`;
}

function minutosESegundos(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function montarEntrada(dados: {
  titulo: string;
  /** O @ da conta, sem o @; nulo no vídeo sem dono. */
  handle: string | null;
  descricao: string | null;
  duracaoS: number;
  /** Os capítulos que o dono escreveu na descrição (vazio quando não escreveu). */
  capitulosDaDescricao: { inicioS: number; titulo: string }[];
  /** A transcrição já com as marcas de tempo aproximadas (`transcricaoComTempos`). */
  transcricaoComTempos: string;
  nomeNicho: string;
  termosNicho: string[];
}): string {
  const descricao = dados.descricao ? Array.from(dados.descricao).slice(0, MAX_CARACTERES_DESCRICAO).join("") : null;
  const capitulos =
    dados.capitulosDaDescricao.length > 0
      ? `Capítulos que o dono escreveu na descrição (tempos exatos):\n${dados.capitulosDaDescricao.map((c) => `${minutosESegundos(c.inicioS)} ${c.titulo}`).join("\n")}`
      : "Capítulos que o dono escreveu na descrição: nenhum (proponha os capítulos pelo texto).";
  const conta = dados.handle ? `@${dados.handle}` : "(sem conta)";
  return [
    `Nicho: ${dados.nomeNicho} (termos: ${dados.termosNicho.join(", ")})`,
    "",
    `Conta: ${conta}`,
    `Titulo: ${dados.titulo}`,
    `Duracao: ${Math.round(dados.duracaoS)} segundos (${minutosESegundos(dados.duracaoS)})`,
    `Descricao (o começo): ${descricao ?? "(sem descrição)"}`,
    "",
    capitulos,
    "",
    "Transcricao (as marcas entre colchetes são aproximadas):",
    dados.transcricaoComTempos,
    "",
    LEMBRETE_ACENTUACAO,
  ].join("\n");
}
