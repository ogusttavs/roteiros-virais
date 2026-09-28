import { z } from "zod";

import {
  FIGURINHAS_STORY,
  TIPOS_ABERTURA,
  type FormatoRoteiro,
  type Objetivo,
  type TipoAbertura,
  type TipoMarca,
} from "@/db/schema";
import { JARGAO } from "@/lib/regras-de-texto";

import { INSTRUCAO_TIPO_ABERTURA, NOME_OBJETIVO } from "../enums";
import type { EsforcoIA, NivelIA } from "../tipos";

import { textoRegrasStory } from "./regras-formato";

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
 *
 * Segunda rodada do PR #42, item 7: o cabecalho do bloco dizia "cada uma
 * vale como uma proibicao dele", contradizendo a propria regra dura 8
 * (a fraca cede, so a firme vale como proibicao). So o texto do cabecalho
 * muda, a instrucao de verdade ja estava certa na regra 8. Versao 1.7.1.
 *
 * V4, roteiro sem vicio (escopo 5.12, item 4): o prompt deixa de ensinar
 * abertura por conta propria (saem os exemplos fixos de gancho e a regra 6
 * perde a frase "comece com outra pergunta ou outra cena", que prescrevia
 * tipo). Quem decide o tipo de abertura agora e o servico
 * (`servicos/roteiro.ts`, `escolherTipoAbertura`), a partir da evidencia do
 * dia; a entrada traz essa instrucao (regra 9, nova) e o schema ganha
 * `tipoAbertura`, o modelo declarando o que de fato escreveu. O motivo de
 * reprovacao "Gancho fraco" (regra 7) para de prescrever "resultado ou
 * cena, nunca pergunta" e passa a apontar para essa mesma instrucao.
 * Versao 1.8.0.
 *
 * V9a, o momento (item 1, 2 e 4 do `PROXIMO.md`): terceira origem de
 * roteiro, "a pessoa fala onde está e o que está acontecendo, sem busca de
 * evidência no banco". `montarSistemaEstavel` ganha `tipo` (regra dura 12,
 * nova: "pessoa" escreve em primeira pessoa do singular, "negocio" continua
 * como sempre); `montarEntrada` ganha o bloco do momento (regra dura 10,
 * nova: o gancho nasce da cena, cita pelo menos um elemento concreto), o
 * contexto de série (os últimos momentos gravados por este cliente, para
 * não repetir ângulo) e a marca citada (regra dura 11, nova: aparece como
 * parte da vida de quem grava, nunca como anúncio). O schema ganha
 * `temaCurto`, preenchido só com o momento, a linha curta que vira
 * `roteiros.tema` (a busca de evidência não roda para esta origem, não há
 * tema escolhido de antemão). Versao 1.9.0.
 *
 * Item 0 da revisão do PR #55 (V9b, item 1): a regra 12 para "negocio"
 * proibia qualquer primeira pessoa do singular, o que também bloqueava "eu
 * testei" ou "eu uso" na fala de quem grava contando a própria experiência,
 * exatamente a voz que a tese do produto pede. A regra passa a proibir só um
 * "nós" inventado, não a pessoa contando o que ela fez. Versao 1.9.1.
 *
 * V9c, Story como formato (item 2, E34 enxuta, primeiro uso da base numerada
 * de `estrategia/briefing-e-rubricas.md`, seção 9, num prompt inteiro):
 * `montarSistemaEstavel` e `montarEntrada` ganham `formato`. Com "story", a
 * regra 5 e o parágrafo de estrutura trocam de texto (cartões numerados no
 * lugar de gancho/corpo/fechamento/chamada, as dez regras `R-IG-STORY` de
 * `regras-formato.ts` citadas por número), e a linha de tipo de abertura
 * some da entrada (o primeiro cartão tem regra própria, R-IG-STORY-02; V4
 * não se aplica). O schema ganha `cartoes` (2 a 5, nulo em Reels) e
 * `porQueAssim` (uma entrada por regra numerada que o modelo seguiu, vazio
 * em Reels nesta rodada); `gancho`, `corpo`, `fechamento` e `chamadaFinal`
 * ficam nuláveis (nulos em Story) e `tipoAbertura` também (nulo em Story).
 * Versao 2.0.0.
 *
 * V9d, item 0 (golden set de Stories rodado pelo Fable em 25/09 com chave
 * real: 5 de 5 reprovados no verificador, sempre pelos mesmos três motivos,
 * do prompt, não do verificador): **um**, `porQueAssim` citava as regras
 * duras gerais (1 a 12) além das `R-IG-STORY`, porque "uma entrada por
 * regra numerada da lista acima" não deixava claro qual lista; agora diz
 * explicitamente que só regra com número `R-IG-STORY-nn` entra, nunca as
 * regras duras do começo do texto, mesmo sendo numeradas. **Dois**, cartões
 * passavam de 15 segundos de fala (até 48 palavras num caso; o verificador
 * reprova acima de 37, `PALAVRAS_MAX_POR_CARTAO`): o modelo não conta
 * segundos, conta palavras, então a regra 5 e o bloco de estrutura passam a
 * dizer o número direto, "no máximo 35 palavras" (dois de folga abaixo do
 * teto do verificador). **Três**, jargão dentro do motivo de `porQueAssim`
 * (uma das palavras do catálogo `JARGAO`, `lib/regras-de-texto.ts`): a
 * instrução agora proíbe a lista inteira também nesse campo, montada em
 * tempo de execução (`montarInstrucaoJargaoPorQueAssim`, mesmo padrão de
 * `avaliarResposta.ts`, para o `checar-texto` não reprovar este arquivo por
 * escrever a palavra proibida por extenso). O verificador não mudou
 * (`ia/verificador.ts` já cobria os três casos; o
 * problema era só o modelo não saber a regra certa). Versao 2.0.1.
 */
export const versao = "2.0.1";
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
/** V9c, item 2: um cartão de Story (`R-IG-STORY-03`). */
const cartaoStory = z.object({
  oQueFalar: z.string(),
  oQueMostrar: z.string(),
  textoNaTela: z.string(),
  figurinha: z.enum(FIGURINHAS_STORY),
});
/** V9c, item 2: uma entrada por regra numerada que o modelo seguiu de fato. */
const porQueAssimItem = z.object({ regra: z.string(), motivo: z.string() });

export const schema = z.object({
  titulo: z.string(),
  duracaoS: z.number(),
  /** Nulo em Story: a estrutura desse formato é `cartoes`, abaixo (V9c, item 2). */
  gancho: z.string().nullable(),
  corpo: z.string().nullable(),
  fechamento: z.string().nullable(),
  chamadaFinal: z.string().nullable(),
  /** Só em Story, de 2 a 5 (`R-IG-STORY-03`); nulo em Reels (V9c, item 2). */
  cartoes: z.array(cartaoStory).min(2).max(5).nullable(),
  /** As regras que o modelo seguiu de fato, com o motivo em português de gente; vazio em Reels nesta rodada. */
  porQueAssim: z.array(porQueAssimItem),
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
  /**
   * O tipo de abertura que de fato foi usado (V4, item 4): o modelo declara,
   * o verificador confere. Nulo em Story (V9c, item 2): o primeiro cartão
   * tem regra própria, `R-IG-STORY-02`; `escolherTipoAbertura` (V4) não se
   * aplica a este formato.
   */
  tipoAbertura: z.enum(TIPOS_ABERTURA).nullable(),
  /**
   * V9a, item 1: só preenchido quando a entrada traz o bloco "O momento que
   * a pessoa descreveu agora", uma linha curta (até 8 palavras) resumindo o
   * assunto, que vira `roteiros.tema` no lugar do tema provisório. Nulo nos
   * demais casos (sugerido e livre já têm o tema antes de gerar).
   */
  temaCurto: z.string().nullable(),
});

export type SaidaRoteiro = z.infer<typeof schema>;

/**
 * V9d, item 0 (golden set de Stories, achado do Fable em 25/09: jargão dentro do motivo de
 * `porQueAssim`): mesmo padrão de `avaliarResposta.ts`, `montarInstrucaoJargao`, montado em tempo de
 * execução porque o `checar-texto` reprova qualquer arquivo de `src/ia/prompts/` que tenha a palavra
 * escrita inteira; este arquivo só referencia `item.palavra` e `item.usar`, nunca a palavra em si.
 */
function montarInstrucaoJargaoPorQueAssim(): string {
  return JARGAO.map((item) => `nunca "${item.palavra}"`).join(", ");
}

export function montarSistemaEstavel(dados: {
  perfilCompilado: string;
  modeloNicho: string;
  camadaExclusiva: string;
  /** A memória do cliente (E27, parte 2): `regrasAtivasDoCliente`, ordenada por contagem. Vazia sem nenhuma regra ainda. */
  regrasCliente: { regra: string; contagem: number }[];
  /** V9a, item 4: "negocio" (padrão) fala como a marca; "pessoa" fala em primeira pessoa do singular. */
  tipo: TipoMarca;
  /** V9c, item 2: troca a regra 5, a regra 9 e o parágrafo de estrutura pelo bloco de cartões e as regras R-IG-STORY. */
  formato: FormatoRoteiro;
}): string {
  const ehStory = dados.formato === "story";
  const blocoRegrasCliente =
    dados.regrasCliente.length > 0
      ? `\n\nO que este cliente já reprovou (siga a regra 8: a firme vale como proibição, a fraca deve ser evitada):\n${dados.regrasCliente
          .map((r) => `- ${r.regra} (${r.contagem >= 2 ? "firme" : "fraca"})`)
          .join("\n")}`
      : "";
  const regraVoz =
    dados.tipo === "pessoa"
      ? `12. Este cliente é uma pessoa falando de si, não um negócio: escreva sempre em primeira ` +
        `pessoa do singular ("eu", "meu", "minha"), nunca "a gente" ou "nosso".`
      : `12. Este cliente é um negócio: a voz é a da marca ("a gente", "nossa loja") quando fala do ` +
        `negócio, e a primeira pessoa do singular é bem-vinda quando quem grava conta a própria ` +
        `experiência ("eu testei", "eu uso"); nunca invente um "nós" que não existe.`;

  /**
   * V9c, item 2: Reels continua "fala direta, vertical, curto"; Story troca para "cartões, sem gancho de
   * três segundos". V9d, item 0: "até 15 segundos" virou "no máximo 35 palavras" porque o modelo não
   * conta segundos, conta palavras (o golden set achou cartões de até 48 palavras contra o teto de 37 do
   * verificador); 35 é a folga de dois abaixo do teto.
   */
  const regra5 = ehStory
    ? `5. Formato Story: o vídeo sai em cartões curtos (de 2 a 5, regra R-IG-STORY-03 abaixo), nunca em ` +
      `gancho, corpo, fechamento e chamada; cada cartão tem no máximo 35 palavras de fala, nunca mais.`
    : `5. Formato do MVP: fala direta para câmera, vertical, curto. A duração vem do modelo do\n   nicho.`;

  /**
   * V9c, item 2: em Story, o primeiro cartão tem regra própria (R-IG-STORY-02); `escolherTipoAbertura`
   * (V4) não se aplica, e a entrada nunca traz a linha "Tipo de abertura" para este formato
   * (`montarEntrada`). Deixe `tipoAbertura` nulo na saída.
   */
  const regra9 = ehStory
    ? `9. Este roteiro é um Story: não existe "tipo de abertura" (isso é coisa de Reels, regra R-IG-STORY-02
   cuida do primeiro cartão). Deixe o campo tipoAbertura da saída nulo.`
    : `9. A entrada diz o tipo de abertura deste roteiro (o serviço escolhe, a partir da evidência
   de hoje, sem repetir os últimos roteiros do cliente), às vezes com um vídeo de exemplo:
   inspire-se no estilo dele, nunca copie a frase. Quando a entrada só trouxer uma lista de
   tipos a evitar, escolha livremente qualquer outro tipo. Declare no campo tipoAbertura da
   saída qual tipo você de fato usou.`;

  /**
   * V9c, item 2: o bloco de estrutura por formato, primeiro uso da base numerada (E36) num prompt
   * inteiro. O texto das regras vem de `regras-formato.ts`, que copia a seção 9.1 das rubricas.
   *
   * V9d, item 0 (golden set de Stories, 5 de 5 reprovados, os três motivos do Fable em 25/09): "no
   * máximo 35 palavras" no lugar de "até 15 segundos" (o modelo conta palavras, não segundos);
   * `porQueAssim` agora diz explicitamente que só regra `R-IG-STORY-nn` entra, nunca as regras duras
   * numeradas de 1 a 12 do começo do texto (o modelo entendia "regra numerada" como as duas listas
   * juntas); e o motivo proíbe o mesmo jargão da regra dura 4, para o campo `porQueAssim` em si, não só
   * os campos de texto de tela.
   */
  const blocoEstrutura = ehStory
    ? `Estrutura do roteiro em Story: cartões numerados, de 2 a 5, um assunto por cartão, cada um com no
máximo 35 palavras de fala; cada cartão tem o que falar, o que mostrar, o texto curto que fica fixo na
tela, e a figurinha de interação quando fizer sentido (ou "nenhuma" quando não pedir interação
nenhuma). Siga as regras do Story à risca:

${textoRegrasStory()}

Depois de escrever, preencha também porQueAssim: uma entrada só para cada regra com número
R-IG-STORY-nn da lista acima que você de fato seguiu (nunca as regras duras numeradas de 1 a 12 do
começo deste texto, mesmo sendo numeradas), com o número (ex. "R-IG-STORY-04") e o motivo em
português de gente, sem jargão no motivo (${montarInstrucaoJargaoPorQueAssim()}), sem citar o número
dentro do motivo. Nunca cite uma regra que não está na lista das R-IG-STORY acima.`
    : `Estrutura do roteiro: gancho nos primeiros segundos, corpo, fechamento, chamada final.
Cenas com o momento e o que fazer. Bloco de edição com o texto que entra na tela
(quando, o quê, onde), o ritmo de corte, os recursos, o áudio quando houver, e a referência
(o vídeo, o segundo exato e o que olhar) quando existir um vídeo de evidência com análise
visual.`;

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
${regra5}
6. Não repita o ângulo de um roteiro recente do mesmo cliente (lista abaixo, com o gancho de
   cada um); se o tema pedido for muito parecido com um deles, escolha um ângulo diferente
   para o gancho e a estrutura. O gancho novo não pode repetir nem parafrasear nenhum gancho
   recente.
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
   Gancho fraco: outro tipo de abertura, o que o serviço indicou abaixo.
   Outro motivo: siga o que o cliente escreveu com as próprias palavras dele.
8. Quando a lista "o que este cliente já reprovou" aparecer abaixo, siga cada regra dela à
   risca; a marcada "firme" (duas reprovações ou mais) vale tanto quanto uma proibição do
   perfil, a marcada "fraca" (uma reprovação só) ainda deve ser evitada, mas cede se
   conflitar de verdade com o tema pedido.
${regra9}
10. Quando a entrada trouxer um bloco "O momento que a pessoa descreveu agora", o gancho
    nasce da cena que está na frente do celular, não do tema abstrato: cite pelo menos um
    elemento concreto do momento (o lugar, o que está acontecendo ou o que dá para mostrar)
    nos primeiros três segundos. Nesse caso, preencha também o campo temaCurto do schema com
    uma linha curta (até 8 palavras) resumindo o assunto; nos demais casos, deixe temaCurto
    nulo.
11. Quando a entrada trouxer uma marca citada, ela aparece como parte da vida real de quem
    grava, nunca como anúncio ou propaganda; se o objetivo for as pessoas comprarem, a
    chamada final aponta para a marca citada, não para a marca deste roteiro. A chamada final
    sempre cita uma marca só, nunca as duas.
${regraVoz}

O objetivo escolhido muda o roteiro:
- Mais gente me conhecer: gancho amplo, assunto quente do nicho, chamada final de seguir ou
  compartilhar.
- As pessoas lembrarem de mim quando precisarem: responde uma dúvida real do cliente,
  chamada final de comentar ou salvar.
- Gente me chamar para comprar: ataca o medo antes da compra, mostra prova real, chamada
  final de chamar ou agendar.

${blocoEstrutura}

Perfil do cliente:
${dados.perfilCompilado}${blocoRegrasCliente}

O que só este cliente tem (cidade, concorrentes, perfis que admira; use quando fizer sentido
no gancho ou na chamada final, nunca force):
${dados.camadaExclusiva}

Modelo do nicho:
${dados.modeloNicho}

Escreva em português do Brasil, com acentuação correta.`;
}

/**
 * O que `escolherTipoAbertura` (`servicos/roteiro.ts`) decidiu (V4, item 3):
 * com `tipo`, uma instrução concreta (com ou sem vídeo de exemplo); sem
 * evidência tipada nenhuma, só a lista do que evitar.
 */
export type InstrucaoAbertura =
  | { tipo: TipoAbertura; ganchoExemplo: string | null }
  | { tipo: null; tiposProibidos: TipoAbertura[] };

function formatarInstrucaoAbertura(instrucao: InstrucaoAbertura): string {
  if (instrucao.tipo === null) {
    return instrucao.tiposProibidos.length > 0
      ? `Tipo de abertura: livre, qualquer um dos oito tipos menos estes, já usados nos ` +
          `últimos roteiros deste cliente: ${instrucao.tiposProibidos.join(", ")}.`
      : `Tipo de abertura: livre, o que fizer mais sentido para este vídeo.`;
  }
  const exemplo = instrucao.ganchoExemplo
    ? ` Um vídeo de hoje abriu assim, use só como inspiração de estilo, nunca copie a frase: ` +
      `"${instrucao.ganchoExemplo}"`
    : "";
  return `Tipo de abertura: ${instrucao.tipo}, ${INSTRUCAO_TIPO_ABERTURA[instrucao.tipo]}.${exemplo}`;
}

export function montarEntrada(dados: {
  tema: string;
  objetivo: Objetivo;
  /** V9c, item 2: com "story", a linha "Tipo de abertura" nunca entra (regra dura 9). */
  formato: FormatoRoteiro;
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
  /** V4, item 3: o que `escolherTipoAbertura` decidiu para este roteiro. */
  instrucaoAbertura: InstrucaoAbertura;
  /**
   * A versão que o cliente reprovou (E27, parte 1, item 3; antes "outro
   * ângulo", etapa 11, decisão 4): o gancho e o corpo dela, para o modelo
   * saber exatamente o que não repetir, além da regra geral contra
   * `roteirosRecentes`. `motivos` são os rótulos de `MOTIVOS_REPROVACAO`
   * (não os ids); sempre pelo menos um, `reprovarERescrever` exige.
   */
  anguloParaEvitar?: { gancho: string; corpo: string; motivos: string[]; motivoTexto?: string };
  /**
   * V9a, item 1: só quando `origem = "momento"`; sem busca de evidência,
   * esta é a única descrição da cena, então substitui a linha "Tema
   * escolhido" e o bloco de evidência (ver regra dura 10).
   */
  momento?: { onde: string; oQueEstaAcontecendo: string; oQueDaParaMostrar: string };
  /**
   * V9a, item 2: os últimos momentos gravados por este cliente nos últimos
   * 10 dias (mesma janela de `roteirosRecentes`), "o que já foi gravado
   * nesta sequência". Vazio ou ausente fora da origem momento.
   */
  contextoDeSerie?: { tema: string; gancho: string }[];
  /**
   * V9a, item 4: a marca que a pessoa citou durante o momento, já resolvida
   * (nome e perfil compilado), quando ela é membro de mais de uma marca e
   * escolheu "Falar de" uma diferente da ativa. Ver regra dura 11.
   */
  marcaCitada?: { nome: string; perfilCompilado: string };
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

  const blocoMomento = dados.momento
    ? `O momento que a pessoa descreveu agora:\nOnde: ${dados.momento.onde}\nO que está ` +
      `acontecendo: ${dados.momento.oQueEstaAcontecendo}\nO que dá para mostrar: ` +
      `${dados.momento.oQueDaParaMostrar}`
    : null;

  const blocoSerie =
    dados.contextoDeSerie && dados.contextoDeSerie.length > 0
      ? `O que já foi gravado nesta sequência de momentos, não repita o mesmo ângulo:\n${dados.contextoDeSerie
          .map((r) => `"${r.tema}", gancho: "${r.gancho}"`)
          .join("; ")}`
      : null;

  const blocoMarcaCitada = dados.marcaCitada
    ? `Marca citada por quem está gravando (regra dura 11):\n${dados.marcaCitada.nome}: ${dados.marcaCitada.perfilCompilado}`
    : null;

  const partes = [
    dados.momento ? null : `Tema escolhido: ${dados.tema}`,
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
    blocoMomento,
    blocoSerie,
    blocoMarcaCitada,
    dados.momento ? null : blocoEvidencia,
    `Roteiros recentes deste cliente, para nao repetir angulo:\n${listaRecentes}`,
    dados.formato === "reels" ? formatarInstrucaoAbertura(dados.instrucaoAbertura) : null,
  ].filter((parte): parte is string => Boolean(parte));

  return partes.join("\n\n");
}
