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
 *
 * Achado do primeiro uso no iPad, item 3: o roteiro do dia 2 comecou igual
 * ao do dia 1, porque `roteirosRecentes` so levava titulo, objetivo e
 * status, nunca o gancho, entao o modelo nao tinha como saber qual frase de
 * abertura ja foi usada. `roteirosRecentes` ganha o gancho de cada roteiro
 * (agora dos ultimos 10 dias, nao so os ultimos 10, `servicos/roteiro.ts`),
 * e a regra dura 6 vira explicita sobre nao repetir nem parafrasear o
 * gancho. A segunda camada de defesa (comparacao por codigo, nao so
 * instrucao no prompt) fica no verificador (`verificador.ts`,
 * `verificarLocalmente`), no mesmo espirito da licao do PR #17. Versao
 * 1.5.0.
 *
 * E27, parte 1, item 3: "outro angulo" vira "reprovar com motivo"
 * (`servicos/roteiro.ts`, `reprovarERescrever`). `anguloParaEvitar` ganha
 * `motivos` (os rotulos de `config/motivos-reprovacao.ts`, nao os ids) e
 * `motivoTexto`; a entrada passa a nomear os motivos escolhidos, em vez da
 * frase generica "pediu outro angulo". A instrucao concreta de cada um dos
 * oito motivos possiveis fica no sistema estavel (regra dura 7, sempre
 * presente, cacheada): a entrada so precisa dizer QUAL motivo, o modelo ja
 * sabe O QUE fazer com cada um, sem repetir a instrucao inteira a cada
 * chamada. Versao 1.6.0.
 *
 * E27, parte 2, item 3: `montarSistemaEstavel` ganha `regrasCliente`, a
 * memoria do cliente (`servicos/aprendizado.ts`, `regrasAtivasDoCliente`):
 * o que ele ja reprovou em rodadas anteriores, nao so na versao que esta
 * sendo reescrita agora. Cacheavel junto do resto do bloco estavel; muda
 * so quando o job `aprender-cliente` roda, nao a cada roteiro. Sem
 * regra nenhuma, o bloco nao aparece (teste unitario). Versao 1.7.0.
 */
export const versao = "1.7.0";
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
  /** A memória do cliente (E27, parte 2): `regrasAtivasDoCliente`, ordenada por contagem. Vazia sem nenhuma regra ainda. */
  regrasCliente: { regra: string; contagem: number }[];
}): string {
  const blocoRegrasCliente =
    dados.regrasCliente.length > 0
      ? `\n\nO que este cliente já reprovou (não repita, cada uma vale como uma proibição dele):\n${dados.regrasCliente
          .map((r) => `- ${r.regra} (${r.contagem >= 2 ? "firme" : "fraca"})`)
          .join("\n")}`
      : "";
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
6. Não repita o ângulo de um roteiro recente do mesmo cliente (lista abaixo, com o gancho de
   cada um); se o tema pedido for muito parecido com um deles, escolha um ângulo diferente
   para o gancho e a estrutura. O gancho novo não pode repetir nem parafrasear nenhum gancho
   recente: comece de um jeito diferente, com outra pergunta ou outra cena.
7. Quando o cliente reprovou a versão anterior, a entrada diz por qual motivo (um ou mais,
   desta lista fixa) e o que fazer em cada caso:
   Não é assim que eu falo: use só as palavras e o tom do perfil do cliente, nada de frase
   feita ou genérica.
   Não dá para gravar isso hoje: só cena que dá para gravar sozinho, no lugar de trabalho,
   sem preparação nem equipamento especial.
   Já falei disso: outro ângulo do mesmo tema, ou outro exemplo, sem repetir o que os
   roteiros recentes já disseram.
   Não é o meu cliente: fale com quem realmente compra, a pessoa que o perfil descreve.
   Muito longo: corte para caber em menos tempo que a versão anterior, sem tirar o exemplo
   concreto.
   Não combina com o objetivo: reescreva o fechamento e a chamada final para o objetivo
   travado.
   Gancho fraco: gancho novo que comece pelo resultado ou pela cena, nunca por pergunta
   retórica.
   Outro motivo: siga o que o cliente escreveu com as próprias palavras dele.
8. Quando a lista "o que este cliente já reprovou" aparecer abaixo, siga cada regra dela à
   risca; a marcada "firme" (duas reprovações ou mais) vale tanto quanto uma proibição do
   perfil, a marcada "fraca" (uma reprovação só) ainda deve ser evitada, mas cede se
   conflitar de verdade com o tema pedido.

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
${dados.perfilCompilado}${blocoRegrasCliente}

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
  /** Dos ultimos 10 dias (`servicos/roteiro.ts`, `historicoDeRoteiros`), com o gancho de cada um. */
  roteirosRecentes: { tema: string; objetivo: Objetivo; status: string; gancho: string }[];
  /**
   * A versão que o cliente reprovou (E27, parte 1, item 3; antes "outro
   * ângulo", etapa 11, decisão 4): o gancho e o corpo dela, para o modelo
   * saber exatamente o que não repetir, além da regra geral contra
   * `roteirosRecentes`. `motivos` são os rótulos de `MOTIVOS_REPROVACAO`
   * (não os ids); sempre pelo menos um, `reprovarERescrever` exige.
   */
  anguloParaEvitar?: { gancho: string; corpo: string; motivos: string[]; motivoTexto?: string };
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
      ? dados.roteirosRecentes
          .map((r) => `"${r.tema}" (${NOME_OBJETIVO[r.objetivo]}, ${r.status}), gancho: "${r.gancho}"`)
          .join("; ")
      : "nenhum roteiro anterior";

  const partes = [
    `Tema escolhido: ${dados.tema}`,
    `Objetivo: ${NOME_OBJETIVO[dados.objetivo]}`,
    dados.observacao ? `O que o cliente pediu de diferente: ${dados.observacao}` : null,
    dados.anguloParaEvitar
      ? `O cliente reprovou a versão anterior por: ${dados.anguloParaEvitar.motivos.join(", ")}.` +
        (dados.anguloParaEvitar.motivoTexto
          ? ` O que ele escreveu: ${dados.anguloParaEvitar.motivoTexto}.`
          : "") +
        ` A nova versão precisa resolver isso sem mudar o objetivo (continua: ` +
        `${NOME_OBJETIVO[dados.objetivo]}). Não repita o gancho nem a estrutura dela:\n` +
        `gancho: ${dados.anguloParaEvitar.gancho}\ncorpo: ${dados.anguloParaEvitar.corpo}`
      : null,
    blocoEvidencia,
    `Roteiros recentes deste cliente, para nao repetir angulo:\n${listaRecentes}`,
  ].filter((parte): parte is string => Boolean(parte));

  return partes.join("\n\n");
}
