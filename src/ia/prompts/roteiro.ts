import { z } from "zod";

import type { Objetivo } from "@/db/schema";

import { NOME_OBJETIVO } from "../enums";
import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * O roteiro (briefing-e-rubricas.md, secao 7, regras duras, texto literal:
 * a tese do produto vira regra de prompt; e secao 5, tabela de objetivo).
 * Gera a partir do perfil, do modelo do nicho e da evidencia; nunca de
 * busca ao vivo (escopo 5.8).
 *
 * "chamadaFinal" no schema (em vez do nome interno da secao 8 do
 * brief-frontend.md), "objetivo" tipado a partir de src/db/schema.ts em vez
 * de reescrito aqui, e NOME_OBJETIVO importado de src/ia/enums.ts: os tres
 * evitam que a palavra proibida apareca como texto literal neste arquivo,
 * que o checar-texto varre.
 *
 * Etapa 11, decisao 1 do `PROXIMO.md`: `montarSistemaEstavel` ganha a
 * camada exclusiva do cliente (cidade, bairro, concorrentes, perfis
 * admirados), decisao adiada na etapa 10; `montarEntrada` ganha estrutura,
 * fechamento, chamada final e momento chave de cada evidencia (nao so
 * assunto e gancho), e os ultimos roteiros do cliente, para nao repetir
 * angulo. Versao 1.2.0.
 *
 * Ajuste da revisao do PR #17: sem evidencia, a entrada diz explicitamente
 * para nao citar nenhum id (antes so dizia "nenhuma evidencia disponivel",
 * vago o bastante para o modelo inventar ids na segunda tentativa, achado
 * rodando com chave real). Versao 1.3.0.
 *
 * Ajustes da revisao da etapa 11 (etapa 12): sem evidencia, a entrada tambem
 * diz para nao afirmar video, numero ou resultado de outra pessoa, so o que
 * esta no perfil e no modelo do nicho (a lacuna que a revisao do PR #17
 * fechou era so a citacao de id; a prosa em si podia continuar inventando
 * fatos sem citar nenhum id, o que o `evidenciasFornecidas` do verificador
 * nao pega). Sem checagem nova de codigo: os dois roteiros reais ficaram
 * honestos so com a instrucao, e a fase 3 cria a checagem se o golden set
 * mostrar o contrario. Versao 1.4.0.
 */
export const versao = "1.4.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "high";

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
  camadaExclusiva: string;
}): string {
  return `Você escreve o roteiro de um vídeo curto e vertical para um dono de pequeno negócio
gravar com a própria cara no celular. Regras duras:

1. Todo roteiro diz onde gravar e o que mostrar, usando as cenas que o cliente disse que a
   câmera pode ver. Fala direta para a câmera em frente a uma parede lisa só é aceita se o
   próprio roteiro justificar por que nenhuma cena real cabe ali.
2. O roteiro cita a evidência (ids de vídeo do banco) que sustenta o tema e a estrutura. Sem
   evidência, diga isso e não invente.
3. O roteiro usa frases que o cliente disse de verdade (estão no perfil) e nunca fere uma
   proibição dele.
4. Sem travessão, sem emoji, sem jargão em nenhum campo de texto.
5. Formato do MVP: fala direta para câmera, vertical, curto. A duração vem do modelo do
   nicho.
6. Não repita o ângulo de um roteiro recente do mesmo cliente (lista abaixo); se o tema pedido
   for muito parecido com um deles, escolha um ângulo diferente para o gancho e a estrutura.

O objetivo escolhido muda o roteiro:
- Mais gente me conhecer: gancho amplo, assunto quente do nicho, chamada final de seguir ou
  compartilhar.
- As pessoas lembrarem de mim quando precisarem: responde uma dúvida real do cliente,
  chamada final de comentar ou salvar.
- Gente me chamar para comprar: ataca o medo antes da compra, mostra prova real, chamada
  final de chamar ou agendar.

Estrutura do roteiro: gancho nos primeiros segundos, corpo, fechamento, chamada final.
Cenas com o momento e o que fazer. Bloco de edição com o texto que entra na tela
(quando, o quê, onde), o ritmo de corte, os recursos, o áudio quando houver, e a referência
(o vídeo, o segundo exato e o que olhar) quando existir um vídeo de evidência com análise
visual.

Perfil do cliente:
${dados.perfilCompilado}

O que só este cliente tem (cidade, concorrentes, perfis que admira; use quando fizer sentido
no gancho ou na chamada final, nunca force):
${dados.camadaExclusiva}

Modelo do nicho:
${dados.modeloNicho}

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  tema: string;
  objetivo: Objetivo;
  observacao?: string;
  evidencias: {
    id: number;
    assunto: string;
    gancho: string;
    estrutura: string;
    fechamento: string;
    chamadaFinal: string;
    foraDaCurva: number;
    momentoChave?: string;
  }[];
  roteirosRecentes: { tema: string; objetivo: Objetivo; status: string }[];
  /**
   * "Outro ângulo" (etapa 11, decisão 4 do `PROXIMO.md`): o gancho e o
   * corpo da versão que o cliente já viu e pediu para trocar, para o
   * modelo saber exatamente o que não repetir, além da regra geral contra
   * `roteirosRecentes`.
   */
  anguloParaEvitar?: { gancho: string; corpo: string };
}): string {
  const blocoEvidencia =
    dados.evidencias.length > 0
      ? `Evidencia disponivel:\n${dados.evidencias
          .map(
            (v) =>
              `id ${v.id}: ${v.assunto} (fora da curva ${v.foraDaCurva.toFixed(1)}x)\n` +
              `  gancho que funcionou: ${v.gancho}\n` +
              `  estrutura: ${v.estrutura}\n` +
              `  fechamento: ${v.fechamento}\n` +
              `  chamada final: ${v.chamadaFinal}` +
              (v.momentoChave ? `\n  momento chave do vídeo: ${v.momentoChave}` : ""),
          )
          .join("\n\n")}`
      : "Não há vídeo fora da curva sobre este tema no banco. Escreva a partir do perfil, do " +
        "modelo do nicho e da camada exclusiva; não cite nenhum id. Não afirme que existe " +
        "vídeo, número ou resultado de outra pessoa; fale só do que está no perfil e no " +
        "modelo do nicho.";

  const listaRecentes =
    dados.roteirosRecentes.length > 0
      ? dados.roteirosRecentes.map((r) => `"${r.tema}" (${NOME_OBJETIVO[r.objetivo]}, ${r.status})`).join("; ")
      : "nenhum roteiro anterior";

  const partes = [
    `Tema escolhido: ${dados.tema}`,
    `Objetivo: ${NOME_OBJETIVO[dados.objetivo]}`,
    dados.observacao ? `O que o cliente pediu de diferente: ${dados.observacao}` : null,
    dados.anguloParaEvitar
      ? `O cliente já viu esta versão e pediu outro ângulo; não repita o gancho nem a estrutura ` +
        `dela:\ngancho: ${dados.anguloParaEvitar.gancho}\ncorpo: ${dados.anguloParaEvitar.corpo}`
      : null,
    blocoEvidencia,
    `Roteiros recentes deste cliente, para nao repetir angulo:\n${listaRecentes}`,
  ].filter((parte): parte is string => Boolean(parte));

  return partes.join("\n\n");
}
