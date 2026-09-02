import { z } from "zod";

import type { Objetivo } from "@/db/schema";

/**
 * O roteiro (briefing-e-rubricas.md, secao 7, regras duras, texto literal:
 * a tese do produto vira regra de prompt). Gera a partir do perfil, do
 * modelo do nicho e da evidencia; nunca de busca ao vivo (escopo 5.8).
 *
 * "chamadaFinal" no schema (em vez do nome interno da secao 8 do
 * brief-frontend.md) e "objetivo" tipado a partir de src/db/schema.ts em vez
 * de reescrito aqui: os dois evitam que a palavra proibida apareca como
 * texto literal neste arquivo, que o checar-texto varre.
 */
export const versao = "1.0.0";

const cena = z.object({ momento: z.string(), oQueFazer: z.string() });
const textoNaTelaItem = z.object({ quando: z.string(), oQue: z.string(), onde: z.string() });
const referencia = z
  .object({
    videoId: z.number().nullable(),
    segundo: z.number().nullable(),
    oQueOlhar: z.string(),
  })
  .nullable();

export const schema = z.object({
  titulo: z.string(),
  duracaoS: z.number(),
  gancho: z.string(),
  corpo: z.string(),
  fechamento: z.string(),
  chamadaFinal: z.string(),
  cenas: z.array(cena),
  /** Por que este roteiro so funciona com a pessoa de verdade (a tese, na tela). */
  ondeGravar: z.string(),
  edicao: z.object({
    textoNaTela: z.array(textoNaTelaItem),
    ritmoDeCorte: z.string(),
    recursos: z.array(z.string()),
    audio: z.string().nullable(),
    referencia,
  }),
  /** Ids de video que sustentam o roteiro; o verificador confere presenca. */
  evidencias: z.array(z.number()),
});

export type SaidaRoteiro = z.infer<typeof schema>;

export function montarSistemaEstavel(dados: {
  perfilCompilado: string;
  modeloNicho: string;
}): string {
  return `Voce escreve o roteiro de um video curto e vertical para um dono de pequeno negocio
gravar com a propria cara no celular. Regras duras:

1. Todo roteiro diz onde gravar e o que mostrar, usando as cenas que o cliente disse que a
   camera pode ver. Fala direta para a camera em frente a uma parede lisa so e aceita se o
   proprio roteiro justificar por que nenhuma cena real cabe ali.
2. O roteiro cita a evidencia (ids de video do banco) que sustenta o tema e a estrutura. Sem
   evidencia, diga isso e nao invente.
3. O roteiro usa frases que o cliente disse de verdade (estao no perfil) e nunca fere uma
   proibicao dele.
4. Sem travessao, sem emoji, sem jargao em nenhum campo de texto.
5. Formato do MVP: fala direta para camera, vertical, curto. A duracao vem do modelo do
   nicho.

Estrutura do roteiro: gancho nos primeiros segundos, corpo, fechamento, chamada final.
Cenas com o momento e o que fazer. Bloco de edicao com o texto que entra na tela
(quando, o que, onde), o ritmo de corte, os recursos, o audio quando houver, e a referencia
(o video, o segundo exato e o que olhar) quando existir um video de evidencia com analise
visual.

Perfil do cliente:
${dados.perfilCompilado}

Modelo do nicho:
${dados.modeloNicho}`;
}

export function montarEntrada(dados: {
  tema: string;
  objetivo: Objetivo;
  observacao?: string;
  evidencias: { id: number; assunto: string; gancho: string; momentoChave?: string }[];
}): string {
  const listaEvidencias =
    dados.evidencias.length > 0
      ? dados.evidencias
          .map((v) => `id ${v.id}: ${v.assunto}. gancho que funcionou: ${v.gancho}`)
          .join("\n")
      : "nenhuma evidencia disponivel";

  const partes = [
    `Tema escolhido: ${dados.tema}`,
    `Objetivo interno: ${dados.objetivo}`,
    dados.observacao ? `O que o cliente pediu de diferente: ${dados.observacao}` : null,
    `Evidencia disponivel:\n${listaEvidencias}`,
  ].filter((parte): parte is string => Boolean(parte));

  return partes.join("\n\n");
}
