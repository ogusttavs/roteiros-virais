import { z } from "zod";

import { estruturaDaFicha } from "@/config/fichas";
import {
  FIGURINHAS_STORY,
  TIPOS_ABERTURA,
  type EstiloRoteiro,
  type Ficha,
  type FormatoRoteiro,
  type Objetivo,
  type Persona,
  type QuemGrava,
  type TipoAbertura,
  type TipoMarca,
} from "@/db/schema";
import { JARGAO } from "@/lib/regras-de-texto";

import { INSTRUCAO_TIPO_ABERTURA, NOME_OBJETIVO } from "../enums";
import type { EsforcoIA, NivelIA } from "../tipos";

import { regrasDoReels, textoRegras, textoRegrasStory } from "./regras-formato";

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
 *
 * M4, o roteiro do vídeo sem fala (decisão do Gustavo em 30/09/2026, "a gente não pode pensar em
 * apenas vídeos falando"): novo `estilo`, ortogonal ao `formato` (um Reels ou um Story podem ser
 * `falado` ou `sem_fala`). Sem fala sempre usa a estrutura de cartões (a mesma de Story, `cartoes`),
 * com `oQueFalar` sempre vazio: cada cartão é uma cena (o que filmar) e o texto curto que entra na
 * tela (no máximo 8 palavras por vez), nunca fala; a chamada para ação vai no texto da última cena e
 * na legenda do post, novo campo `legenda` do schema (só preenchido quando sem fala). Sem regras
 * numeradas de plataforma para este estilo ainda (a base da seção 9 não cobre sem fala; fica para a
 * R1, fila do Sonnet), então `porQueAssim` continua vazio, como em Reels falado hoje. `tipoAbertura`
 * fica nulo (não existe "jeito de começar a falar" quando não há fala). Versao 2.1.0.
 *
 * E40, o roteiro na mão da pessoa (reunião do Gustavo com o Bruno em 01/10/2026). **Um**, novo
 * parâmetro opcional `objetivoDoVideo` em `montarEntrada` ("o que este vídeo precisa comunicar?"):
 * quando presente, entra como a primeira linha da entrada, acima do tema, como instrução de
 * primeira ordem ("o vídeo existe para comunicar isto"). **Dois**, `R-IG-STORY-03` mudou (decisão
 * do Gustavo): de 1 a 5 stories (era de 2 a 5, coisa rápida agora cabe num story só) e até 60
 * segundos de fala por story (era 15s, número nosso sem base; 60 é o teto real da Central de
 * Ajuda). A regra 5, o bloco de estrutura e `regras-formato.ts` trocam "cartão"/"cartões" por
 * "story"/"stories" (decisão do Gustavo: é a palavra que a tela e o prompt usam agora); o schema
 * solta o limite para 1 a 5 (`cartoes`), e `ia/verificador.ts` confere o número exato por estilo
 * (Story: 1 a 5; sem fala: 2 a 5, sem mudança). Versao 2.2.0.
 *
 * H2 (achado do Gustavo em 29/09/2026, mesma causa de avaliarResposta): o que o cliente
 * escreveu no perfil ou no tema pode vir sem acento, o roteiro que a IA escreve nunca pode.
 * Versao 2.3.0.
 *
 * V12c, item 2 (a E37b): `montarSistemaEstavel` ganha `persona`; quem escolheu "ficar
 * conhecido" ganha a regra 14 (renumerada do item 3, abaixo), a chamada final nunca fecha em
 * preco ou compra. Versao 2.4.0.
 *
 * V12c, item 3 (a E37b): `montarSistemaEstavel` ganha `quemAparece` (ja resolvido pelo
 * servico); quando e a equipe sem o dono, ou outra pessoa, a regra 13 troca a voz da regra 12
 * (nunca "eu testei" de quem nao aparece; texto para quem apresenta, nunca "eu, dono"). Versao
 * 2.5.0.
 *
 * 2.5.1 (hotfix do Fable em 01/10/2026, achado do Gustavo em produção: quatro roteiros de Reels
 * falado reprovados seguidos com "porQueAssim cita regra que nao existe na lista"): o bloco de
 * Reels falado não dizia nada sobre `porQueAssim`, o schema exige a lista, e o modelo a enchia
 * com as regras duras em texto livre. Agora o bloco manda deixar vazio, e o serviço descarta o
 * campo fora de Story falado antes do verificador (`servicos/roteiro.ts`).
 *
 * H4, item 1 (achado do Gustavo em produção em 01/10/2026, o caso do roteiro 12: a referência
 * escolhida em código, pelo maior múltiplo, saiu um meme sem nada a ver com o roteiro): a
 * regra nova 12 (as antigas 12, 13 e 14 viram 13, 14 e 15) diz ao modelo para escolher a
 * própria referência entre a evidência disponível, ou deixar nula quando nenhuma serviu de
 * modelo de verdade; `servicos/roteiro.ts` só confere que o id devolvido pertence à evidência
 * fornecida (`validarReferenciaDoModelo`), nunca escolhe por conta própria. Versão 2.6.0.
 *
 * R1, item 2 (pedido do Gustavo em 29/09/2026: todo roteiro saindo baseado nas boas práticas
 * documentadas das plataformas): o Reels falado ganha o bloco "Siga as regras do <rede> à risca"
 * e o `porQueAssim`, igual ao Story (antes só R-IG-STORY existia). A rede vem de
 * `clientes.redePrincipal` (`regrasDoReels`, `regras-formato.ts`); sem rede escolhida, Instagram.
 * Corrigido de passagem: a instrução de `porQueAssim` dizia "regras duras numeradas de 1 a 12",
 * desatualizada desde que a H4 renumerou para 15. Versão 2.7.0.
 *
 * R1, acabamento (achado do Sonnet na prova com chave real da H4, 01/10/2026): o lembrete de
 * acentuação se repete no fim da entrada (`LEMBRETE_ACENTUACAO`), mesma correção de
 * `avaliarResposta` 1.6.1. Versão 2.7.1.
 *
 * R1, achado da prova com chave real (01/10/2026, caso 6 de 9 do golden set de exemplo): a
 * R-IG-REEL-11 sugere gravar um Story junto quando o objetivo é vender ou ser lembrado, e o
 * modelo, uma vez em nove, entendeu isso como "produza cartões de Story aqui dentro": saiu um
 * Reels com `cartoes` preenchido e a narrativa confusa, reprovado por `verificarTexto` ("bloco de
 * instruções técnicas misturado com fala, não um roteiro claro"). Frase nova deixa explícito que
 * a sugestão de Story vira texto no bloco de edição, nunca estrutura própria; a estrutura deste
 * roteiro continua sendo Reels sempre. Versão 2.7.2.
 *
 * Achado 11 da revisão do motor (01/10/2026): `LEMBRETE_ACENTUACAO` sai de dentro de
 * `montarEntrada` (onde a segunda tentativa colava o motivo da reprovação depois dele, empurrando
 * o lembrete para o meio da entrada) e vira exportado; `servicos/roteiro.ts` passa ele para
 * `gerarComVerificacao` como `lembreteFinal`, que garante a posição certa nas duas tentativas.
 * Versão 2.7.3.
 *
 * E43: quando o roteiro nasce de "Criar vídeo com esta notícia" (Tema livre, estado
 * `comNoticia`), o título, o resumo e o ângulo sugerido da notícia entram como um bloco, logo
 * depois do tema (a notícia é o que fez a pessoa escrever aquele tema, não o substitui: a busca de
 * evidência continua normal, ao contrário do momento). Versão 2.8.0.
 *
 * E44 PR 1 (formato da referência): cada vídeo de evidência traz a linha "formato do vídeo" (as treze chaves do estudo, `config/formatos.ts`), e um parágrafo logo depois das regras numeradas (sem virar a 13ª, para o `porQueAssim` seguir citando de 1 a 12) pede o
 * roteiro naquele formato, sempre como a versão da própria marca (a tese: um meme adaptado ao negócio, com a cara de quem grava, nunca o vídeo de outro repostado).
 * Versão 2.9.0.
 *
 * E49 PR 1 (as fichas): no Reels a entrada traz a linha "Ficha do vídeo" (as cinco fichas do "O que você quer que esse vídeo faça?", `config/fichas.ts`) com a estrutura dela, e um parágrafo
 * depois do bloco do objetivo diz que a ficha manda no começo, no jeito de contar e no pedido do fim; o verificador local reprova a ficha "que guardem" sem passo a passo, lista ou
 * algo para copiar. Sem a linha (Story, roteiros de antes), tudo segue como na 2.9.0. Versão 2.10.0.
 *
 * O roteiro não inventa fato (achado do Bruno e do Gustavo no teste de 04/10/2026: do momento do plano da viagem, o roteiro trouxe "o Uli está aqui do meu lado com a mochila nas costas",
 * "uma mesa de hotel com café já frio", "um país quase caiu do roteiro porque a feira repetia o que vejo no Brasil", "uma parada ganhou dois dias a mais por causa da fábrica", e o modelo
 * misturou o motivo da reprovação anterior com o assunto do roteiro). **Um**, um parágrafo novo (não é regra numerada, para o `porQueAssim` continuar citando só as listas): todo fato concreto
 * tem de estar no momento, no perfil, no tema, na notícia, no pedido do cliente ou na evidência; o que faltar vira um espaço marcado entre colchetes, nunca cena inventada. **Dois**, o motivo
 * da reprovação e a versão reprovada entram na entrada como "só sobre a FORMA, nunca fonte de fato". **Três**, `montarFontesDosFatos` monta o que vale como fato para o verificador
 * (`verificarTexto` 1.6.0 reprova o fato fora das fontes). Versão 2.11.0.
 *
 * 2.11.1 (golden set com chave, 04/10/2026: os momentos reprovados eram todos de prática do negócio inventada, "testo no quarto do hotel", "anoto a pergunta ao lado do fornecedor", "mala de amostras na
 * feira"): o parágrafo diz explicitamente que o fato inclui COMO a pessoa trabalha e o que ela oferece; se o momento ou o perfil não disseram, não existe e vira "[conte aqui como você faz isso]". Versão 2.11.1.
 */
export const versao = "2.11.1";
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
  /**
   * Em Story, de 1 a 5 (`R-IG-STORY-03`, E40: era de 2 a 5); em sem fala, de 2 a 5 (M4, sem
   * mudança); nulo em Reels falado (V9c, item 2). O limite solto aqui (1 a 5) cobre os dois
   * casos; `verificarCartoesStory` e `verificarCartoesSemFala` conferem o número exato de cada
   * estilo.
   */
  cartoes: z.array(cartaoStory).min(1).max(5).nullable(),
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
  /**
   * M4: a legenda do post, pronta para copiar, com a chamada para ação dentro dela. Só preenchida
   * quando o estilo é sem fala (o roteiro falado já entrega a chamada final como fala, no corpo do
   * vídeo); nula no estilo falado. O verificador confere presença quando sem fala.
   */
  legenda: z.string().nullable(),
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
  /**
   * V12c, item 2, a E37b: "conhecido" nunca fecha a chamada final em preço ou compra. Opcional
   * (ao contrário de `tipo`, que todo chamador já tinha) para não forçar os scripts de golden
   * set e os testes existentes a passar um valor que não muda o resultado deles; ausente se
   * comporta como qualquer persona que não seja "conhecido".
   */
  persona?: Persona;
  /**
   * V12c, item 3, a E37b: quem aparece NESTE vídeo (já resolvido pelo serviço: o valor do
   * roteiro quando a pessoa trocou, senão o `quemGrava` do briefing). Opcional pelo mesmo
   * motivo de `persona`; ausente ou "propria_pessoa" não muda a regra 14.
   */
  quemAparece?: QuemGrava;
  /** V9c, item 2: troca a regra 5, a regra 9 e o parágrafo de estrutura pelo bloco de cartões e as regras R-IG-STORY. */
  formato: FormatoRoteiro;
  /** M4: sem fala troca a regra 5, a regra 9 e o parágrafo de estrutura pelo bloco de cenas sem fala, igual em Reels e em Story. */
  estilo: EstiloRoteiro;
  /**
   * R1, item 2: a rede principal da marca (`clientes.redePrincipal`) escolhe o conjunto de
   * regras de plataforma que o Reels falado segue; ausente ou nula usa Instagram, o padrão do
   * produto. Sem efeito em Story (que sempre usa `R-IG-STORY`) nem em sem fala.
   */
  redePrincipal?: "youtube" | "tiktok" | "instagram" | null;
  /** R1, item 2: `modeloNicho.duracaoTipicaS.max`, para o YouTube somar as regras de vídeo longo às de Short acima de 60s. */
  duracaoTipicaMaxS?: number;
}): string {
  const ehStory = dados.formato === "story";
  const ehSemFala = dados.estilo === "sem_fala";
  const redeReels = regrasDoReels(dados.redePrincipal, dados.duracaoTipicaMaxS);
  const blocoRegrasCliente =
    dados.regrasCliente.length > 0
      ? `\n\nO que este cliente já reprovou (siga a regra 8: a firme vale como proibição, a fraca deve ser evitada):\n${dados.regrasCliente
          .map((r) => `- ${r.regra} (${r.contagem >= 2 ? "firme" : "fraca"})`)
          .join("\n")}`
      : "";
  /** V12c, item 2, a E37b: quem escolheu "ficar conhecido" nunca fecha vendendo. */
  const regraPersonaConhecido =
    dados.persona === "conhecido"
      ? "\n15. Este cliente quer ficar conhecido no que faz, não vender agora: a chamada final " +
        "nunca é preço, comprar ou agendar, mesmo que o objetivo do vídeo pareça pedir isso; é " +
        "sempre seguir, comentar, salvar ou indicar para alguém."
      : "";
  const regraVoz =
    dados.tipo === "pessoa"
      ? `13. Este cliente é uma pessoa falando de si, não um negócio: escreva sempre em primeira ` +
        `pessoa do singular ("eu", "meu", "minha"), nunca "a gente" ou "nosso".`
      : `13. Este cliente é um negócio: a voz é a da marca ("a gente", "nossa loja") quando fala do ` +
        `negócio, e a primeira pessoa do singular é bem-vinda quando quem grava conta a própria ` +
        `experiência ("eu testei", "eu uso"); nunca invente um "nós" que não existe.`;
  /**
   * V12c, item 3, a E37b: a regra 13 pressupõe o dono contando a própria experiência; quando
   * quem aparece neste vídeo é a equipe (sem o dono) ou outra pessoa, isso muda.
   */
  const regraQuemAparece =
    dados.tipo === "negocio" && dados.quemAparece === "equipe"
      ? "\n14. Quem aparece neste vídeo é a equipe, o dono não aparece: nunca escreva experiência " +
        'pessoal do dono ("eu testei", "eu uso"); fale sempre como a equipe ou a marca ("a gente", ' +
        '"aqui na loja").'
      : dados.tipo === "negocio" && dados.quemAparece === "outra_pessoa"
        ? "\n14. Quem aparece neste vídeo é outra pessoa (um apresentador, um criador ou um " +
          'cliente), não o dono: escreva o texto para essa pessoa falar, nunca em primeira pessoa ' +
          'do dono ("eu, dono"); ela fala sobre a marca de fora, como quem apresenta ou recomenda.'
        : "";

  /**
   * V9c, item 2: Reels continua "fala direta, vertical, curto"; Story troca para "cartões, sem gancho de
   * três segundos". V9d, item 0: "até 15 segundos" virou "no máximo 35 palavras" porque o modelo não
   * conta segundos, conta palavras (o golden set achou cartões de até 48 palavras contra o teto de 37 do
   * verificador); 35 é a folga de dois abaixo do teto.
   */
  const regra5 = ehSemFala
    ? `5. Este roteiro é sem fala: o vídeo sai em cenas curtas (de 2 a 5), nenhum bloco tem fala ` +
      `nenhuma, só o que filmar e o texto curto que entra na tela (no máximo 8 palavras por vez, ` +
      `pode trocar mais de uma vez dentro da mesma cena).`
    : ehStory
      ? `5. Formato Story: o vídeo sai em stories curtos (de 1 a 5, regra R-IG-STORY-03 abaixo), nunca em ` +
        `gancho, corpo, fechamento e chamada; cada story tem no máximo 150 palavras de fala, nunca mais.`
      : `5. Formato do MVP: fala direta para câmera, vertical, curto. A duração vem do modelo do\n   nicho.`;

  /**
   * V9c, item 2: em Story, o primeiro cartão tem regra própria (R-IG-STORY-02); `escolherTipoAbertura`
   * (V4) não se aplica, e a entrada nunca traz a linha "Tipo de abertura" para este formato
   * (`montarEntrada`). Deixe `tipoAbertura` nulo na saída.
   */
  const regra9 = ehSemFala
    ? `9. Este roteiro é sem fala: não existe "tipo de abertura" (isso é sobre como a pessoa começa a
   falar). Deixe o campo tipoAbertura da saída nulo. O gancho é o que aparece na tela, imagem ou
   texto, nos 3 primeiros segundos.`
    : ehStory
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
  const blocoEstrutura = ehSemFala
    ? `Estrutura do roteiro sem fala: cenas numeradas, de 2 a 5. Nenhuma cena tem fala, em campo
nenhum: deixe oQueFalar sempre como string vazia. Cada cena tem o que mostrar (a cena, o que
filmar) e o texto curto que entra na tela (no máximo 8 palavras por vez; pode trocar mais de uma
vez dentro da mesma cena, descreva as trocas em oQueMostrar). A figurinha de interação é opcional,
use "nenhuma" quando a cena não pedir interação. A chamada para ação vai no texto da última cena
e também pronta no campo legenda, com a chamada para ação dentro dela; não deixe legenda vazia.
Como não há regras numeradas de plataforma para este estilo ainda, deixe porQueAssim como lista
vazia.`
    : ehStory
      ? `Estrutura do roteiro em Story: stories numerados, de 1 a 5 (coisa rápida cabe em um story só;
o que não cabe num story vai para o seguinte), um assunto por story, cada um com no máximo 150
palavras de fala; cada story tem o que falar, o que mostrar, o texto curto que fica fixo na tela, e
a figurinha de interação quando fizer sentido (ou "nenhuma" quando não pedir interação nenhuma).
Com um story só, ele é o primeiro e o último ao mesmo tempo, e as regras dos dois valem juntas. Se
o assunto pedir mais de 5 stories, corte o que sobra em vez de passar do limite. Siga as regras do
Story à risca:

${textoRegrasStory()}

Depois de escrever, preencha também porQueAssim: uma entrada só para cada regra com número
R-IG-STORY-nn da lista acima que você de fato seguiu (nunca as regras duras numeradas de 1 a 15 do
começo deste texto, mesmo sendo numeradas), com o número (ex. "R-IG-STORY-04") e o motivo em
português de gente, sem jargão no motivo (${montarInstrucaoJargaoPorQueAssim()}), sem citar o número
dentro do motivo. Nunca cite uma regra que não está na lista das R-IG-STORY acima.`
      : `Estrutura do roteiro: gancho nos primeiros segundos, corpo, fechamento, chamada final.
Cenas com o momento e o que fazer. Bloco de edição com o texto que entra na tela
(quando, o quê, onde), o ritmo de corte, os recursos e o áudio quando houver (a referência é a
regra 12 acima, vale para qualquer formato). Siga as regras do ${redeReels.nome} à risca:

${textoRegras(redeReels.regras)}

Mesmo quando uma regra da lista sugerir gravar também um Story, ESTE roteiro continua sendo um
Reels: gancho, corpo, fechamento e chamada final continuam preenchidos, e cartoes continua nulo
(nunca escreva cartões de Story aqui). Uma sugestão de Story vira uma frase no bloco de edição
(recursos ou áudio), nunca estrutura própria.

Depois de escrever, preencha também porQueAssim: uma entrada só para cada regra da lista acima
que você de fato seguiu (nunca as regras duras numeradas de 1 a 15 do começo deste texto, mesmo
sendo numeradas), com o número dela e o motivo em português de gente, sem jargão no motivo
(${montarInstrucaoJargaoPorQueAssim()}), sem citar o número dentro do motivo. Nunca cite uma regra
que não está na lista acima.`;

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
12. A referência (edicao.referencia), em qualquer formato: escolha, entre os vídeos de
    evidência disponíveis, UM que você de fato usou como modelo de estrutura (a forma de
    contar essa história, não só o assunto); devolva o id dele em videoId, o segundo exato
    quando a evidência trouxer um "momento chave" para esse vídeo (senão, 0) em segundo, e uma
    frase curta do que vale a pena olhar nele em oQueOlhar. Se nenhum vídeo da evidência de
    fato serviu de modelo, deixe edicao.referencia nulo inteiro; nunca force uma referência só
    porque existe evidência disponível. Referência errada é pior que referência nenhuma.
O formato do vídeo de referência (esta não é uma das regras numeradas acima): quando a evidência
que você usou como modelo trouxer a linha "formato do vídeo", escreva o roteiro NESSE formato
(um "passo a passo" ensina do começo ao resultado; um "antes e depois" mostra como estava e
como ficou; um "humor e meme" é uma brincadeira curta; e assim por diante), sempre como a
versão desta marca: o negócio, a voz e a cara de quem grava, nunca o vídeo de outra pessoa
repostado nem a mesma piada copiada. Um meme vira a sua versão do assunto, gravada pela
pessoa, com o que só ela tem (o local, o produto, o cliente). Sem a linha, escolha o formato
que melhor serve ao tema.
Nenhum fato que ninguém contou (esta não é uma das regras numeradas acima, para o porQueAssim
continuar citando só as listas): todo fato concreto do roteiro (uma pessoa, um lugar, um objeto,
um número, uma data, uma cena, uma coisa que aconteceu) tem de estar no momento que a pessoa
descreveu, no perfil do cliente, no tema, na notícia, no que o cliente pediu ou na evidência.
O que o roteiro precisaria e não tem, você não inventa: deixa um espaço marcado entre colchetes,
com a instrução para quem grava, como "[diga aqui onde você está]" ou "[o número real do seu
preço]". Nunca invente cena para dar vida ao texto (quem está do lado, o que tem na mesa, o tempo
que faz, o que aconteceu antes). Isso inclui COMO a pessoa trabalha e o que ela oferece ("eu testo
antes", "anoto a pergunta de cada fornecedor", "respondo no direct", "levei a mala de amostras",
"na nossa loja"): se o momento ou o perfil não disseram, não existe, e vira um espaço marcado como
"[conte aqui como você faz isso]". Entrada curta é normal: um roteiro curto, com espaços marcados,
vale mais que um roteiro cheio de detalhe que ninguém contou. O motivo que o cliente deu ao
reprovar uma versão, e o texto da versão reprovada, dizem só como NÃO escrever; nunca são fonte
de fato.
${regraVoz}${regraQuemAparece}${regraPersonaConhecido}

O objetivo escolhido muda o roteiro:
- Mais gente me conhecer: gancho amplo, assunto quente do nicho, chamada final de seguir ou
  compartilhar.
- As pessoas lembrarem de mim quando precisarem: responde uma dúvida real do cliente,
  chamada final de comentar ou salvar.
- Gente me chamar para comprar: ataca o medo antes da compra, mostra prova real, chamada
  final de chamar ou agendar.
Quando a entrada traz a linha "Ficha do vídeo", ela manda: o começo, o jeito de contar e o que
você pede no fim seguem a estrutura dela, no lugar da lista acima.

${blocoEstrutura}

Perfil do cliente:
${dados.perfilCompilado}${blocoRegrasCliente}

O que só este cliente tem (cidade, concorrentes, perfis que admira; use quando fizer sentido
no gancho ou na chamada final, nunca force):
${dados.camadaExclusiva}

Modelo do nicho:
${dados.modeloNicho}

Escreva em português do Brasil, com acentuação correta. O que o cliente escreveu no perfil ou
no tema pode vir sem acento; o roteiro que você escreve sai sempre acentuado, mesmo assim.`;
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

/**
 * R1, acabamento (achado do Sonnet na prova com chave real da H4, 01/10/2026: o roteiro sem
 * fala reprovou por dez campos sem acentuação, a mesma causa raiz de `avaliarResposta` 1.6.1):
 * a instrução de acentuação só no sistema estável não bastou; o modelo lê por último, antes de
 * escrever, o que vem no fim da entrada, mesma posição de `avaliarResposta.ts`, onde a instrução
 * pegou (9 de 18 reprovados virou 0 de 18 lá). Achado 11 da revisão do motor: `gerarComVerificacao`
 * é quem garante a posição (`lembreteFinal`, `servicos/roteiro.ts`), não mais `montarEntrada`
 * diretamente, para a segunda tentativa não empurrar isto para o meio do texto.
 */
export const LEMBRETE_ACENTUACAO =
  "Escreva o roteiro inteiro com a acentuação correta do português (você, não, já, também, é, está), mesmo que o tema ou o perfil do cliente estejam sem acento.";

export function montarEntrada(dados: {
  tema: string;
  objetivo: Objetivo;
  /** E49 PR 1: a ficha do Reels; vira a linha "Ficha do vídeo" com a estrutura dela. */
  ficha?: Ficha;
  /**
   * E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto que a pessoa
   * escreve no tema livre, na folha do momento ou no dia do plano. Quando presente, vira a
   * primeira linha da entrada, acima do tema, como instrução de primeira ordem.
   */
  objetivoDoVideo?: string;
  /** V9c, item 2: com "story", a linha "Tipo de abertura" nunca entra (regra dura 9). */
  formato: FormatoRoteiro;
  /** M4: sem fala também nunca traz a linha "Tipo de abertura" (regra dura 9). */
  estilo: EstiloRoteiro;
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
    /** M4: marca o vídeo de evidência que é ele próprio sem fala, útil de inspiração para este estilo. */
    semFala?: boolean;
    /** E44 PR 1: o nome do formato do vídeo de referência (`config/formatos.ts`), quando já foi classificado. */
    formato?: string;
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
  /**
   * E43: presente quando o tema nasceu de "Criar vídeo com esta notícia". Ao contrário do
   * momento, não substitui `tema` nem o bloco de evidência: a notícia é o que motivou a pessoa a
   * escrever aquele tema, a busca de evidência no banco continua normal.
   */
  noticia?: { titulo: string; resumo: string | null; angulo: string | null };
}): string {
  const blocoEvidencia =
    dados.evidencias.length > 0
      ? `Evidencia disponivel:\n${dados.evidencias
          .map(
            (v) =>
              `id ${v.id}: ${v.assunto} (fora da curva ${v.foraDaCurva.toFixed(1)}x)${v.semFala ? " (sem fala)" : ""}\n` +
              (v.formato ? `  formato do vídeo: ${v.formato}\n` : "") +
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
          .map(
            (r) => `"${r.tema}" (${NOME_OBJETIVO[r.objetivo]}, ${r.status}), gancho: "${r.gancho}"`,
          )
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

  const blocoNoticia = dados.noticia
    ? `Noticia que deu origem a este tema (a pessoa leu e quis fazer um video sobre isso):\nTitulo: ${dados.noticia.titulo}${dados.noticia.resumo ? `\nResumo: ${dados.noticia.resumo}` : ""}${dados.noticia.angulo ? `\nAngulo sugerido: ${dados.noticia.angulo}` : ""}`
    : null;

  const partes = [
    dados.objetivoDoVideo
      ? `O que este vídeo precisa comunicar (acima de tudo o mais): ${dados.objetivoDoVideo}`
      : null,
    dados.momento ? null : `Tema escolhido: ${dados.tema}`,
    blocoNoticia,
    `Objetivo: ${NOME_OBJETIVO[dados.objetivo]}`,
    dados.ficha && dados.formato === "reels" && dados.estilo === "falado" ? `Ficha do vídeo: ${estruturaDaFicha(dados.ficha, dados.evidencias.length > 0)}` : null,
    dados.observacao ? `O que o cliente pediu de diferente: ${dados.observacao}` : null,
    dados.anguloParaEvitar
      ? `O cliente reprovou a versão anterior por: ${dados.anguloParaEvitar.motivos.join(", ")}.` +
        (dados.anguloParaEvitar.motivoTexto
          ? ` O que ele escreveu (é uma crítica ao jeito do texto, nunca uma informação nova: não vira fato do roteiro): "${dados.anguloParaEvitar.motivoTexto}".`
          : "") +
        ` A nova versão precisa resolver isso sem mudar o objetivo (continua: ` +
        `${NOME_OBJETIVO[dados.objetivo]}). Isto vale só para a FORMA (o jeito de abrir, de contar, o tamanho): ` +
        `a versão reprovada abaixo é só para você NÃO repetir o gancho nem a estrutura dela, e nada do que ela afirma ` +
        `vale como fato; se ela trazia cena, pessoa, lugar ou número que o momento, o perfil, o tema e a evidência não trazem, era invenção e não volta.\n` +
        `Versão reprovada (não repetir):\ngancho: ${dados.anguloParaEvitar.gancho}\ncorpo: ${dados.anguloParaEvitar.corpo}`
      : null,
    blocoMomento,
    blocoSerie,
    blocoMarcaCitada,
    dados.momento ? null : blocoEvidencia,
    `Roteiros recentes deste cliente, para nao repetir angulo:\n${listaRecentes}`,
    dados.formato === "reels" && dados.estilo === "falado"
      ? formatarInstrucaoAbertura(dados.instrucaoAbertura)
      : null,
  ].filter((parte): parte is string => Boolean(parte));

  return partes.join("\n\n");
}

/**
 * O que vale como fato para este roteiro (O roteiro não inventa fato): o perfil, o que só este cliente tem, o tema ou o momento, o que o vídeo precisa comunicar, o pedido do cliente, a notícia,
 * a marca citada e a evidência. Fica de fora o que NÃO é fonte: o motivo da reprovação, a versão reprovada, os roteiros recentes e as regras. É o que o `verificarTexto` recebe como `fontes`.
 */
export function montarFontesDosFatos(dados: {
  perfilCompilado: string;
  camadaExclusiva: string;
  tema?: string;
  momento?: { onde: string; oQueEstaAcontecendo: string; oQueDaParaMostrar: string };
  objetivoDoVideo?: string | null;
  observacao?: string;
  noticia?: { titulo: string; resumo: string | null; angulo: string | null };
  marcaCitada?: { nome: string; perfilCompilado: string };
  evidencias?: { assunto: string; gancho: string; estrutura: string; fechamento: string; chamadaFinal: string }[];
}): string {
  const partes = [
    `Perfil do cliente:\n${dados.perfilCompilado}`,
    dados.camadaExclusiva ? `O que só este cliente tem:\n${dados.camadaExclusiva}` : null,
    dados.momento
      ? `O momento que a pessoa descreveu:\nOnde: ${dados.momento.onde}\nO que está acontecendo: ${dados.momento.oQueEstaAcontecendo}\nO que dá para mostrar: ${dados.momento.oQueDaParaMostrar}`
      : dados.tema
        ? `Tema: ${dados.tema}`
        : null,
    dados.objetivoDoVideo ? `O que o vídeo precisa comunicar: ${dados.objetivoDoVideo}` : null,
    dados.observacao ? `O que o cliente pediu: ${dados.observacao}` : null,
    dados.noticia ? `Notícia: ${dados.noticia.titulo}${dados.noticia.resumo ? `. ${dados.noticia.resumo}` : ""}${dados.noticia.angulo ? `. ${dados.noticia.angulo}` : ""}` : null,
    dados.marcaCitada ? `Marca citada: ${dados.marcaCitada.nome}: ${dados.marcaCitada.perfilCompilado}` : null,
    dados.evidencias && dados.evidencias.length > 0
      ? `Evidência (vídeos de outras pessoas, para o jeito de contar, não para fato do cliente):\n${dados.evidencias.map((v) => `${v.assunto}. ${v.gancho}. ${v.estrutura}`).join("\n")}`
      : null,
  ];
  return partes.filter((p): p is string => Boolean(p)).join("\n\n");
}
