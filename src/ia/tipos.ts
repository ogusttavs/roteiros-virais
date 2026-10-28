import type { NivelIA } from "@/config/precos-ia";

export type { NivelIA };

/**
 * As dez tarefas do plano (plano de execucao, etapas 4 e 10), mais
 * `classificarAbertura` (V4, item 2: backfill do tipo de abertura de
 * analise ja existente, sem ler transcricao de novo), `lerMomento` (V9a,
 * item 3: separa os campos do momento a partir da transcricao ou do texto
 * digitado na folha "Gravar agora"), `lerAgenda` (V9b, item 1: separa a
 * agenda colada ou falada em dias), `planejarDia` (V9b, item 2: sugere de
 * 1 a 3 gravacoes por dia do plano), `sugerirContasDoSetor` (M2, item 1c: ate
 * 30 perfis brasileiros por rede, sempre conferidos na API antes de entrar) e
 * `classificarContaDoSetor` (M2, item 2: "este perfil e deste setor?", pelos
 * ultimos titulos/legendas, mesmo criterio do `pertenceAoNicho` por video),
 * `extrairVideoSemFala` (M3, item 2: a ficha fixa pelos quadros e pela legenda,
 * para o setor que aceita "video sem fala vale") e `organizarFalaBriefing`
 * (P2, item 3: tira as muletas de fala de uma resposta de briefing gravada,
 * sem acrescentar fato nem resumir). `aindaValeRoteiro` (E39b, item a):
 * confere se um roteiro feito com antecedencia ainda vale ou se algo mais
 * forte subiu no setor hoje.
 */
export type TarefaIA =
  | "avaliarResposta"
  | "compilarPerfil"
  | "extrairVideo"
  | "extrairVideoSemFala"
  /** E52 (PR 2): a estrutura de um vídeo longo do YouTube (a abertura que promete, os capítulos, os laços, onde a pessoa sairia), pela transcrição com marcas de tempo aproximadas. */
  | "extrairVideoLongo"
  | "analisarVisual"
  | "modeloNicho"
  | "filtrarNoticias"
  /** E53: o resumo nosso, em duas frases, de uma notícia de um assunto que a pessoa acompanha. */
  | "resumirNoticia"
  /** E55: junta os títulos das buscas em alta do Google e dos vídeos em alta do YouTube no Brasil em assuntos. */
  | "agruparTendencias"
  /** E55: escolhe, entre os assuntos em alta no Brasil, o que cabe no setor e escreve o tema do momento. */
  | "temaDoMomento"
  | "temasDoDia"
  | "avaliarTema"
  | "roteiro"
  /** E52 (PR 3): o roteiro longo do YouTube, por capítulos (a duração-alvo vem da medida dos longos do ramo). */
  | "roteiroLongo"
  | "verificarTexto"
  | "aprenderCliente"
  | "classificarAbertura"
  | "lerMomento"
  | "lerAgenda"
  | "planejarDia"
  | "sugerirContasDoSetor"
  | "classificarContaDoSetor"
  | "organizarFalaBriefing"
  | "filtrarEvidenciaPorMarca"
  /** E17 parte 1: entre até 30 vídeos candidatos do setor, escolhe os que tratam do mesmo assunto do tema livre (a busca por palavra achou pouco). */
  | "reordenarEvidencia"
  | "aindaValeRoteiro"
  /** E26 (4b): as três notas de uma versão do roteiro (viralizar, te chamarem, lembrarem de você), por um juiz separado, o mesmo para todas as versões. */
  | "notaDaVersao"
  /** E28: lê os comentários de um vídeo muito visto do setor e separa o que o público pergunta, reclama, pede e elogia. */
  | "lerComentarios"
  /** Hotfix de 22/10/2026: confere, em lote e barato, se um vídeo é do setor antes de ler os comentários dele. */
  | "conferirVideoDoSetor"
  /** E28: junta, entre os vídeos da semana, o que o público do setor disse de igual (as vozes do público). */
  | "juntarVozes"
  /** E41 (2a): as marcas de fala (peso, pausa, devagar, tom) de um roteiro Reels falado; o modelo só coloca marcas, o texto não muda. */
  | "marcarFala"
  /** E38, partes 2 e 3: a leitura curta de um perfil citado pelo cliente ou da própria marca. */
  | "analisarPerfilCitado"
  /** E38 PR 2: "o que entendemos da sua marca", do site e das redes dela, para ela confirmar. */
  | "entenderMarca"
  /** E54: a pesquisa na hora, pela ferramenta de busca na web da Anthropic (só fontes da lista curada), para um vídeo. */
  | "pesquisaNaHora"
  /** E54: confere a premissa que a pessoa escreveu contra os dados achados e, se falta a posição dela, pergunta em uma frase. */
  | "conferirPremissa"
  /** Melhoria da E53 (23/10/2026): de 3 a 6 palavras de busca para um assunto de notícias que a pessoa escreveu e o catálogo não tem. */
  | "sugerirPalavrasDoAssunto"
  /** E61 PR 1 (28/10/2026): uma frase de foco da conta (o assunto e o público dentro do setor), sugerida a partir do briefing para a pessoa confirmar. */
  | "sugerirFoco";

export type ImagemEntrada = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

export type EsforcoIA = "low" | "medium" | "high";

export type ResultadoGeracao<T> = {
  dados: T;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  tokensCacheEscrita: number;
};
