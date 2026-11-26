/**
 * Dados fixos (secao 1 e 1b) e as treze perguntas do briefing (secao 2 e 2b),
 * copiados literalmente de estrategia/briefing-e-rubricas.md. As telas de
 * /comecar e /briefing leem daqui; nunca reescrever o enunciado ou o "o que
 * a IA procura" na tela ou no servico.
 *
 * P1 (briefing-e-rubricas.md, secao 2b): a marca do tipo pessoa tem as
 * proprias perguntas, com os mesmos ids, blocos e pesos do negocio (a
 * lista de notas, a barra de blocos e as avaliacoes guardadas por id
 * continuam iguais); so o enunciado, o "o que a IA procura" e o rotulo curto
 * mudam. `perguntasDoBriefing(tipo)` decide qual das duas listas usar.
 *
 * E76 PR 2 (avaliação externa de um cadastro real, 26/11/2026): eram doze; a P12 misturava os
 * concorrentes (ou os perfis parecidos, na pessoa) com os perfis admirados, que geram conteúdo
 * diferente. Agora a P12 é só dos concorrentes e a P13, nova, só dos admirados, cada uma com a sua
 * lista de @. As duas pesam 0,5: juntas valem o peso 1 da P12 antiga, e a média e a meta de 8 não
 * mudam por causa da separação. A marca que já tinha a P12 respondida não perde nota: o texto antigo
 * vale para a P12 e cobre a P13 até a pessoa editar a P12 ou responder a P13
 * (`p13CobertaPelaP12Antiga`, em `servicos/briefing-regras.ts`).
 */
import type { Alcance, IdiomaDoConteudo, ModoDeIdioma, Persona, QuemGrava, TipoMarca, TipoPerfilCitado } from "@/db/schema";

export type PersonaOpcao = { valor: Persona; rotulo: string };
export type QuemGravaOpcao = { valor: QuemGrava; rotulo: string };
/**
 * `valor` usa o mesmo tipo da coluna `clientes.alcance` (schema.ts). O nome
 * do campo aqui embaixo é `onde`, não a palavra da coluna: ela está na lista
 * de jargão do cliente (`regras-de-texto.ts`, "mais gente te conhecer" no
 * lugar dela) e o `checar-texto` reprova qualquer `.tsx` que a escreva,
 * mesmo como nome de campo. Mesmo motivo de `montarInstrucaoJargao` em
 * `avaliarResposta.ts`: a palavra fica só onde o checar-texto não olha.
 */
export type OndeOpcao = { valor: Alcance; rotulo: string };

/** E76 PR 3: uma opção de como os idiomas se misturam (`ModoDeIdioma`), com a linha de ajuda quando o rótulo sozinho não basta. */
export type ModoDeIdiomaOpcao = { valor: ModoDeIdioma; rotulo: string; ajuda?: string };
export type IdiomaOpcao = { valor: IdiomaDoConteudo; rotulo: string };

/**
 * E76 PR 3 (avaliação externa do cadastro da Skyline, 26/11/2026): a estratégia de idioma, só com a opção "mais_de_um_pais". As regras de
 * validação estão em `lib/estrategia-de-idioma.ts`; o que cada modo faz no texto da IA, em `ia/prompts/idioma.ts`.
 */
export type IdiomaConfig = {
  rotulo: string;
  ajuda: string;
  opcoes: ModoDeIdiomaOpcao[];
  rotuloPrincipal: string;
  rotuloSegundo: string;
  idiomas: IdiomaOpcao[];
  campoComo: { rotulo: string; ajuda: string };
};

export type DadosFixosConfig = {
  nome: { rotulo: string };
  onde: {
    rotulo: string;
    opcoes: OndeOpcao[];
    campoRegiao: { rotulo: string; ajuda: string };
    /** E42a, item 1: só com a opção "outro_pais". */
    campoPais: { rotulo: string; ajuda: string };
    /** E42a, item 1: só com a opção "mais_de_um_pais". */
    campoPaises: { rotulo: string; ajuda: string };
    /**
     * E42a, item 1: com o público de fora do Brasil (as duas opções novas), a tela diz, numa
     * linha, que a pesquisa de vídeos ainda é feita por aqui (o motor não muda nesta etapa).
     */
    avisoPesquisaNoBrasil: string;
    /** E76 PR 3: só com a opção "mais_de_um_pais". */
    idioma: IdiomaConfig;
  };
  site: { rotulo: string; ajuda: string };
  ramo: {
    rotulo: string;
    ajuda: string;
    opcaoOutro: string;
  };
  persona: {
    rotulo: string;
    opcoes: PersonaOpcao[];
  };
  perfis: { rotulo: string };
  quemGrava: {
    rotulo: string;
    ajuda: string;
    /** Pessoa (P1, item 2): a pergunta nem aparece na tela, sempre "propria_pessoa". */
    opcoes: QuemGravaOpcao[];
    fixoEmPropriaPessoa?: boolean;
  };
};

/**
 * V12c, item 1: substitui cidade e bairro, decisao do Gustavo em 29/09/2026. E42a, item 1 (achado
 * dele em 02/10, no Comecar pelo celular: "ta muito limitado ao Brasil e se for outro pais nao ta
 * falando nada"): as duas opcoes novas, "outro_pais" e "mais_de_um_pais".
 */
const ONDE_OPCOES: OndeOpcao[] = [
  { valor: "brasil", rotulo: "No Brasil inteiro" },
  { valor: "local", rotulo: "Na minha cidade ou região" },
  { valor: "outro_pais", rotulo: "Em outro país" },
  { valor: "mais_de_um_pais", rotulo: "Em mais de um país" },
];

const ONDE_CAMPO_PAIS = { rotulo: "Qual país?", ajuda: 'Por exemplo "Estados Unidos" ou "Portugal".' };
const ONDE_CAMPO_PAISES = { rotulo: "Quais países?", ajuda: 'Por exemplo "Estados Unidos e México".' };
const ONDE_AVISO_PESQUISA_NO_BRASIL =
  "Por enquanto, a pesquisa de vídeos que vira roteiro olha só o Brasil, mesmo com o seu público em outro lugar.";

/**
 * E76 PR 3: a mesma pergunta para o negócio e para a pessoa. Os modos seguem o pedido do plano (português; inglês; o principal com uma linha no
 * outro; metade em cada; outro jeito, com uma frase curta); o espanhol entra só como idioma principal ou segundo, porque "Estados Unidos e
 * México" é o exemplo do próprio campo de países.
 */
const ONDE_IDIOMA: IdiomaConfig = {
  rotulo: "Em que idioma saem os seus vídeos e posts?",
  ajuda: "Vale para o que o seu público ouve e lê. O que o aplicativo te explica continua em português.",
  opcoes: [
    { valor: "so_portugues", rotulo: "Só em português" },
    { valor: "so_ingles", rotulo: "Só em inglês" },
    { valor: "linha_no_outro", rotulo: "Um idioma principal, com uma linha no outro", ajuda: "Tudo no principal e uma frase curta no outro, como o convite do fim repetido." },
    { valor: "metade", rotulo: "Metade em cada", ajuda: "A fala e os slides num idioma; o texto na tela e a legenda no outro." },
    { valor: "outro", rotulo: "De outro jeito", ajuda: "Você conta em poucas palavras." },
  ],
  rotuloPrincipal: "Qual é o idioma principal?",
  rotuloSegundo: "E o outro idioma?",
  idiomas: [
    { valor: "portugues", rotulo: "Português" },
    { valor: "ingles", rotulo: "Inglês" },
    { valor: "espanhol", rotulo: "Espanhol" },
  ],
  campoComo: { rotulo: "Como você mistura os idiomas?", ajuda: 'Por exemplo "só inglês nos Reels, português no resto".' },
};

const DADOS_FIXOS_NEGOCIO: DadosFixosConfig = {
  nome: { rotulo: "Nome do negócio" },
  onde: {
    rotulo: "Onde estão os seus clientes?",
    opcoes: ONDE_OPCOES,
    campoRegiao: { rotulo: "Qual cidade ou região?", ajuda: 'Por exemplo "Campinas e região" ou "zona sul de São Paulo".' },
    campoPais: ONDE_CAMPO_PAIS,
    campoPaises: ONDE_CAMPO_PAISES,
    avisoPesquisaNoBrasil: ONDE_AVISO_PESQUISA_NO_BRASIL,
    idioma: ONDE_IDIOMA,
  },
  site: { rotulo: "O site da sua marca, se tiver", ajuda: "Opcional. Pode escrever só o endereço, como minhaloja.com.br" },
  ramo: {
    rotulo: "Ramo",
    ajuda: "Escreva uma palavra ou uma letra do que o seu negócio faz e escolha na lista. Se não achar, escolha “Não achei o meu”.",
    opcaoOutro: "Não achei o meu",
  },
  persona: {
    rotulo: "O que você quer com os vídeos",
    opcoes: [
      { valor: "negocio", rotulo: "Vender o meu produto ou serviço" },
      { valor: "conhecido", rotulo: "Ficar conhecido no que eu faço" },
      { valor: "criador", rotulo: "Virar criador e atrair marcas" },
    ],
  },
  perfis: { rotulo: "Perfis nas redes" },
  quemGrava: {
    rotulo: "Quem geralmente aparece nos vídeos",
    ajuda: "Pode mudar a cada vídeo. Aqui é só o mais comum.",
    opcoes: [
      { valor: "propria_pessoa", rotulo: "Eu mesmo" },
      { valor: "pessoa_e_equipe", rotulo: "Eu e a equipe" },
      { valor: "equipe", rotulo: "A equipe, eu não apareço" },
      { valor: "outra_pessoa", rotulo: "Outra pessoa: um apresentador, um criador ou um cliente" },
    ],
  },
};

/** Secao 1b: mesma mecanica do negocio, so muda o rotulo e as opcoes ("sem mudar de mecanica", texto da secao). */
const DADOS_FIXOS_PESSOA: DadosFixosConfig = {
  nome: { rotulo: "Nome" },
  onde: {
    rotulo: "Onde está o seu público?",
    opcoes: ONDE_OPCOES,
    campoRegiao: { rotulo: "Qual cidade ou região?", ajuda: 'Por exemplo "Campinas e região" ou "zona sul de São Paulo".' },
    campoPais: ONDE_CAMPO_PAIS,
    campoPaises: ONDE_CAMPO_PAISES,
    avisoPesquisaNoBrasil: ONDE_AVISO_PESQUISA_NO_BRASIL,
    idioma: ONDE_IDIOMA,
  },
  site: { rotulo: "O site da sua marca, se tiver", ajuda: "Opcional. Pode escrever só o endereço, como minhaloja.com.br" },
  ramo: {
    rotulo: "Ramo",
    ajuda: "O ramo do seu assunto principal. Escreva uma palavra ou uma letra e escolha na lista. Se não achar, escolha “Não achei o meu”.",
    opcaoOutro: "Não achei o meu",
  },
  persona: {
    rotulo: "O que você quer com os vídeos",
    opcoes: [
      { valor: "conhecido", rotulo: "Ficar conhecido no que eu faço" },
      { valor: "criador", rotulo: "Virar criador e atrair marcas" },
      { valor: "negocios", rotulo: "Levar gente para os meus negócios" },
    ],
  },
  perfis: { rotulo: "Perfis nas redes" },
  quemGrava: {
    rotulo: "Quem aparece nos vídeos",
    ajuda: "",
    opcoes: [{ valor: "propria_pessoa", rotulo: "Eu mesmo" }],
    fixoEmPropriaPessoa: true,
  },
};

export function dadosFixosDoBriefing(tipo: TipoMarca): DadosFixosConfig {
  return tipo === "pessoa" ? DADOS_FIXOS_PESSOA : DADOS_FIXOS_NEGOCIO;
}

export type PerguntaBriefing = {
  id: string;
  bloco: number;
  blocoNome: string;
  peso: number;
  enunciado: string;
  ajuda: string;
  oQueAIAProcura: string;
  /**
   * Rótulo curto para a lista de notas (brief-frontend.md 6.2, "Ajuste de
   * 06/09/2026", achado do Gustavo usando de verdade: a lista só dizia
   * "P2 · 9,5"). Texto exato do brief, um por pergunta.
   */
  rotuloCurto: string;
  /**
   * E37a, item 3 (textos escritos pelo Fable em 01/10/2026, `PROXIMO.md`): entra no prompt que
   * "Copiar para a sua IA" monta, na linha "Uma boa resposta tem:". Não substitui
   * `oQueAIAProcura`, que continua sendo o critério da nota.
   */
  oQueUmaBoaRespostaTem: string;
  /**
   * V12c, item 7, a E37b (design v2, `Briefing.dc.html`, `.campo-pergunta` de cima do campo de
   * texto): logo acima do campo, depois da lista de perfis citados. E76 PR 2: a P12 e a P13 têm.
   */
  enunciadoCampo?: string;
  /**
   * E76 PR 2: a lista de @ que fica acima do campo (desde a V12c, item 7, a E37b, as duas ficavam na
   * P12): os concorrentes na P12, os perfis admirados na P13.
   */
  perfisCitados?: TipoPerfilCitado;
  /**
   * E76 PR 2: a versão do enunciado, quando ele mudou de sentido depois de já ter respostas guardadas.
   * A avaliação feita depois leva o número em `versaoPergunta` (`AvaliacaoResposta`), e é assim que
   * a nota sabe se a avaliação guardada é do texto antigo. Sem o campo, a pergunta nunca mudou.
   */
  versao?: number;
};

/**
 * E76 PR 2: a versão da P12 depois da separação (concorrentes na P12, admirados na P13). Uma avaliação
 * da P12 sem `versaoPergunta`, ou com um número menor, é do texto antigo, que cobria as duas.
 */
export const VERSAO_P12_SEPARADA = 2;

/**
 * E76 PR 2: o enunciado da P12 antes da separação, palavra por palavra (briefing-e-rubricas.md, seção
 * 2 e 2b, até 26/11/2026). A resposta antiga é lida com ele (o perfil compilado e as fontes da
 * sugestão), para a IA não ler como só de concorrentes um texto que também fala dos admirados.
 */
export const ENUNCIADO_P12_ANTES_DA_SEPARACAO: Record<TipoMarca, string> = {
  negocio: "Cite os concorrentes e os perfis que você admira, e em uma frase o que gosta em cada um.",
  pessoa: "Cite os perfis parecidos e os perfis que você admira, e em uma frase o que gosta em cada um.",
};

const AJUDA_PADRAO_NEGOCIO = "Escreva como se fosse para alguém que nunca ouviu falar do seu ramo.";
const AJUDA_PADRAO_PESSOA = "Escreva como se fosse para alguém que nunca ouviu falar de você.";

const PERGUNTAS_NEGOCIO: PerguntaBriefing[] = [
  {
    id: "p1",
    rotuloCurto: "o que você faz",
    bloco: 1,
    blocoNome: "Sobre o negócio",
    peso: 2,
    enunciado:
      "Em poucas palavras, o que o seu negócio faz hoje? Explique como se estivesse falando com alguém que nunca ouviu falar do seu ramo.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "O que é feito, para quem, e o resultado final na vida da pessoa. Nota alta quando um leigo consegue visualizar a cena.",
    oQueUmaBoaRespostaTem:
      "O que você faz, para quem, e o que muda na vida de quem compra, dito de um jeito que alguém de fora do ramo consiga imaginar a cena.",
  },
  {
    id: "p2",
    rotuloCurto: "o que mais vende",
    bloco: 1,
    blocoNome: "Sobre o negócio",
    peso: 1,
    enunciado:
      "Qual é o produto ou serviço que mais vende, e quanto custa em média? Se puder, diga também o que a pessoa leva junto: o que ela resolve, sente ou evita.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura: "Um item nomeado, um valor ou faixa, e o benefício em linguagem de cliente.",
    oQueUmaBoaRespostaTem:
      "O nome do produto ou serviço que mais sai, o preço ou a faixa de preço, e o que a pessoa ganha com ele nas palavras que um cliente usaria.",
  },
  {
    id: "p3",
    rotuloCurto: "o que faz diferente",
    bloco: 1,
    blocoNome: "Sobre o negócio",
    peso: 1,
    enunciado:
      "O que você faz diferente de quem oferece a mesma coisa perto de você? Conte um caso real em que isso apareceu.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      'Uma diferença que só ele poderia dizer, com história ou número. "Qualidade" e "atendimento humanizado" sem exemplo valem nota média.',
    oQueUmaBoaRespostaTem:
      'Uma diferença que só você poderia contar, com um caso que aconteceu de verdade ou um número. "Qualidade" e "bom atendimento" sem exemplo não contam.',
  },
  {
    id: "p4",
    rotuloCurto: "sua cliente",
    bloco: 2,
    blocoNome: "Sobre quem você atende",
    peso: 1,
    enunciado:
      "Descreva o cliente que você mais gosta de atender: idade, onde mora, o que faz, e em que momento da vida está quando te procura.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    /**
     * H2 (achado do Gustavo em 29/09/2026, no briefing da Overtake Pro): a rubrica pedia pessoa
     * com nome; passa a pedir retrato. Copiado de `estrategia/briefing-e-rubricas.md`, seção 2, P4.
     */
    oQueAIAProcura:
      "Um retrato que dê para enxergar, não um segmento: quem é, o que faz, em que situação está quando procura o negócio. Pode ser um tipo de cliente, não precisa ser uma pessoa real com nome. Momento de vida é o que mais ajuda o gancho.",
    oQueUmaBoaRespostaTem:
      "O retrato de um tipo de cliente que dê para enxergar: idade aproximada, onde mora, o que faz e o que está acontecendo na vida dele quando te procura. Sem nome de pessoa real.",
  },
  {
    id: "p5",
    rotuloCurto: "o medo dela",
    bloco: 2,
    blocoNome: "Sobre quem você atende",
    peso: 2,
    enunciado:
      "Qual é a dúvida, o medo ou a desculpa que essa pessoa tem antes de fechar com você? Escreva com as palavras que ela usa.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "Frases em primeira pessoa do cliente. É a matéria-prima do gancho e do vídeo que vende.",
    oQueUmaBoaRespostaTem:
      "As frases que o cliente diz antes de fechar, do jeito que ele fala: a dúvida, o medo ou a desculpa. Entre aspas, se lembrar das palavras.",
  },
  {
    id: "p6",
    rotuloCurto: "perguntas repetidas",
    bloco: 2,
    blocoNome: "Sobre quem você atende",
    peso: 1,
    enunciado:
      "Quais perguntas seus clientes mais repetem no balcão, no WhatsApp ou na consulta? Liste pelo menos cinco.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura: "Perguntas literais. Cada uma vira um tema com chance de gerar cliente.",
    oQueUmaBoaRespostaTem:
      "Pelo menos cinco perguntas que os clientes repetem, escritas como eles perguntam, no balcão, no WhatsApp ou no atendimento.",
  },
  {
    id: "p7",
    rotuloCurto: "o que quer que aconteça",
    bloco: 3,
    blocoNome: "Sobre o que você quer que aconteça",
    peso: 1,
    enunciado:
      "Quando alguém assiste um vídeo seu, o que você quer que aconteça em seguida? Te chamar, agendar, comprar, guardar o seu contato, indicar para alguém?",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "Uma ação principal e uma secundária. Define a chamada final padrão e a mistura da linha editorial (seção 5).",
    oQueUmaBoaRespostaTem:
      "Uma coisa principal que você quer que a pessoa faça depois do vídeo e uma segunda opção. Por exemplo: chamar no WhatsApp, e se não chamar, guardar o contato.",
  },
  {
    id: "p8",
    rotuloCurto: "onde posta hoje",
    bloco: 3,
    blocoNome: "Sobre o que você quer que aconteça",
    peso: 1,
    enunciado:
      "Onde você posta hoje, com que frequência, e o que já aconteceu de bom ou de ruim quando postou?",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "Rede, ritmo real e um episódio. Um vídeo que já deu certo é evidência de nível conta antes mesmo da primeira coleta.",
    oQueUmaBoaRespostaTem:
      "Em que rede você posta, de quanto em quanto tempo de verdade, e um episódio: um vídeo que deu certo ou que deu errado e o que aconteceu.",
  },
  {
    id: "p9",
    rotuloCurto: "suas frases",
    bloco: 4,
    blocoNome: "Sobre a sua fala",
    peso: 2,
    enunciado:
      "Como você fala com o cliente no dia a dia? Escreva três frases que você diz de verdade, do jeito que saem.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "Frases literais, com gíria e ritmo da pessoa. É o que faz o roteiro soar como ele e não como texto de IA.",
    oQueUmaBoaRespostaTem: "Três frases que você diz no dia a dia para o cliente, exatamente como saem, com a gíria e o jeito.",
  },
  {
    id: "p10",
    rotuloCurto: "o que nunca diria",
    bloco: 4,
    blocoNome: "Sobre a sua fala",
    peso: 1,
    enunciado: "O que você nunca diria ou faria num vídeo? Promessa, palavra, tom, assunto, pessoa.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "Limites explícitos. Entram como proibição dura em todo roteiro e derrubam a nota de encaixe de um tema que os fira.",
    oQueUmaBoaRespostaTem:
      "O que nunca pode aparecer num vídeo seu: promessa que você não faz, palavra que não usa, assunto, tom ou pessoa que fica de fora.",
  },
  {
    id: "p11",
    rotuloCurto: "o que dá para mostrar",
    bloco: 5,
    blocoNome: "O que dá para mostrar, referências e concorrentes",
    peso: 2,
    enunciado:
      "O que a câmera pode mostrar no seu dia a dia? Local, equipe, equipamento, produto sendo usado, antes e depois, bastidor, cliente (com autorização). Diga o que pode e o que não pode aparecer.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "Uma lista de cenas filmáveis. É a pergunta que liga o briefing à tese do produto: os roteiros empurram o que um clone não consegue fazer, e isso só funciona se a IA souber o que existe para mostrar.",
    oQueUmaBoaRespostaTem:
      "Uma lista do que dá para filmar no seu dia: o lugar, a equipe, o equipamento, o produto sendo usado, o antes e depois, o bastidor. E o que não pode aparecer.",
  },
  {
    id: "p12",
    rotuloCurto: "concorrentes",
    bloco: 5,
    blocoNome: "O que dá para mostrar, referências e concorrentes",
    /** E76 PR 2: a P12 e a P13 pesam 0,5 cada, o peso 1 da P12 antiga dividido entre as duas. */
    peso: 0.5,
    versao: VERSAO_P12_SEPARADA,
    perfisCitados: "concorrente",
    /** E76 PR 2: só os concorrentes; os perfis admirados foram para a P13. Os @ ficam na lista acima do campo (V12c, item 7, a E37b). */
    enunciado: "Quem são os seus concorrentes, e o que eles fazem que você faria diferente?",
    enunciadoCampo: "Em uma frase por concorrente, o que ele faz que você faria diferente.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "Concorrentes com o @ na lista acima do campo e, para cada um, o que este negócio faria diferente. Os concorrentes entram na camada exclusiva de pesquisa (escopo 5.6); a diferença mostra o espaço que só ele ocupa.",
    oQueUmaBoaRespostaTem: "Uma frase por concorrente: o que ele faz que você faria diferente. Os @ vão na lista acima.",
  },
  {
    id: "p13",
    rotuloCurto: "perfis que admira",
    bloco: 5,
    blocoNome: "O que dá para mostrar, referências e concorrentes",
    peso: 0.5,
    perfisCitados: "admira",
    /** E76 PR 2: nova, separada da P12. Os @ ficam na lista acima do campo. */
    enunciado: "Quais são os perfis que você admira, e o que gosta em cada um?",
    enunciadoCampo: "Em uma frase por perfil, o que você gosta nele.",
    ajuda: AJUDA_PADRAO_NEGOCIO,
    oQueAIAProcura:
      "Perfis admirados com o @ na lista acima do campo e, para cada um, do que ele gosta ali: o jeito de falar, de explicar, de mostrar ou de editar. Viram referência de tom.",
    oQueUmaBoaRespostaTem:
      "Uma frase por perfil: o que você gosta em cada um que admira, como o jeito de falar, de explicar ou de editar. Os @ vão na lista acima.",
  },
];

/** Secao 2b: mesmos ids, blocos e pesos do negocio; so enunciado, o que a IA procura e o rotulo curto mudam. */
const PERGUNTAS_PESSOA: PerguntaBriefing[] = [
  {
    id: "p1",
    rotuloCurto: "quem você é",
    bloco: 1,
    blocoNome: "Sobre você",
    peso: 2,
    enunciado:
      "Quem é você e o que você faz hoje? Conte como se fosse para alguém que nunca ouviu falar de você: o que você faz de verdade no dia, há quanto tempo, de onde você vem.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      'Uma linha de vida concreta (o que a pessoa faz com as mãos e com o tempo dela, não o cargo), com um número ou um lugar. "Empresário e criador de conteúdo" sem o que faz no dia vale nota média.',
    oQueUmaBoaRespostaTem:
      "O que você faz no seu dia de verdade, há quanto tempo e de onde vem, com um número ou um lugar. Não o cargo: o que você faz com o seu tempo.",
  },
  {
    id: "p2",
    rotuloCurto: "do que quer ser lembrado",
    bloco: 1,
    blocoNome: "Sobre você",
    peso: 1,
    enunciado:
      "Do que você quer que as pessoas lembrem quando pensarem em você? Um ou dois assuntos, no máximo três, e por que você tem propriedade para falar deles (o que já fez, quanto tempo, o que construiu, o que vive).",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "O território: assuntos nomeados e a prova de que ela vive aquilo (o que já fez, quanto tempo, o que construiu). É o que decide de que assunto os temas do dia saem.",
    oQueUmaBoaRespostaTem:
      "Um, dois ou no máximo três assuntos pelos quais você quer ser lembrado, e a prova de que vive cada um: o que já fez, por quanto tempo, o que construiu.",
  },
  {
    id: "p3",
    rotuloCurto: "a sua virada",
    bloco: 1,
    blocoNome: "Sobre você",
    peso: 1,
    enunciado: "Qual é a sua história: como você chegou onde está, e qual foi a virada? Conte um episódio, com época e lugar.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "Um episódio que dê para contar em 30 segundos, com o antes, a virada e o depois. É matéria de gancho pessoal e do vídeo de apresentação.",
    oQueUmaBoaRespostaTem:
      "Um episódio da sua história que dê para contar em meio minuto, com época e lugar: como era antes, o que virou, como ficou depois.",
  },
  {
    id: "p4",
    rotuloCurto: "quem te segue",
    bloco: 2,
    blocoNome: "Sobre quem te acompanha",
    peso: 1,
    enunciado:
      "Quem você quer que te siga? Descreva o tipo de pessoa: o que ela faz, em que momento da vida está, o que ela quer que ainda não tem.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "Um retrato de tipo que dê para enxergar (nunca nome de pessoa real, a mesma regra do negócio). O momento de vida é o que mais ajuda o gancho.",
    oQueUmaBoaRespostaTem:
      "O retrato do tipo de pessoa que você quer que te siga: o que ela faz, em que momento da vida está e o que ela quer e ainda não tem. Sem nome de pessoa real.",
  },
  {
    id: "p5",
    rotuloCurto: "o que querem ver",
    bloco: 2,
    blocoNome: "Sobre quem te acompanha",
    peso: 2,
    enunciado:
      "O que essa pessoa quer ver, aprender ou sentir quando abre um vídeo seu? E o que ela te pergunta ou comenta? Escreva com as palavras dela.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      'Frases em primeira pessoa do público ("como você faz para...", "queria ter coragem de..."). É a matéria-prima do gancho e do vídeo que segura quem chegou.',
    oQueUmaBoaRespostaTem:
      "O que essa pessoa quer ver, aprender ou sentir, e as perguntas e comentários que ela te manda, com as palavras dela.",
  },
  {
    id: "p6",
    rotuloCurto: "suas opiniões",
    bloco: 2,
    blocoNome: "Sobre quem te acompanha",
    peso: 1,
    enunciado:
      "Que opiniões suas geram conversa? Algo em que você acredita e muita gente do seu meio discorda, ou uma verdade que você diz e ninguém fala. Liste pelo menos três, com uma frase de porquê em cada.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      'Posicionamentos literais com o motivo. Cada um vira um tema com chance de gerar conversa, e entram no perfil como "posicionamentos".',
    oQueUmaBoaRespostaTem:
      "Pelo menos três opiniões suas que geram conversa, cada uma com o motivo em uma frase. Aquilo em que você acredita e muita gente do seu meio discorda.",
  },
  {
    id: "p7",
    rotuloCurto: "o que quer que aconteça",
    bloco: 3,
    blocoNome: "Sobre o que você quer que aconteça",
    peso: 1,
    enunciado:
      "Quando alguém assiste um vídeo seu, o que você quer que aconteça? Te seguir, te mandar mensagem, te chamar para conversar, te indicar, conhecer um dos seus negócios, ou uma marca te chamar para uma parceria? Se você tem negócios, inclusive os que ainda está montando, diga qual deles quer que apareça mais nos seus vídeos e de que jeito. Se você vive de parcerias, diga que tipo de marca quer atrair e o que já fez com marcas.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "Uma ação principal e uma secundária, e como a pessoa ganha com isso: pelos negócios dela (quem fala é a pessoa, o negócio aparece como parte da vida, a fábrica, o produto na mão, o cliente, nunca como anúncio) ou pela influência (as marcas que quer atrair, o que já fez com marcas). Define a chamada final padrão e a linha editorial.",
    oQueUmaBoaRespostaTem:
      "O que você quer que aconteça depois do vídeo (uma coisa principal e uma segunda), e como isso te traz resultado: qual negócio seu deve aparecer mais, ou que tipo de marca você quer atrair.",
  },
  {
    id: "p8",
    rotuloCurto: "onde posta hoje",
    bloco: 3,
    blocoNome: "Sobre o que você quer que aconteça",
    peso: 1,
    enunciado: "Onde você posta hoje, com que frequência, e qual vídeo seu mais deu certo até agora? Por que você acha que deu certo?",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "Rede, ritmo real e um episódio com o motivo. Um vídeo que já deu certo é evidência de nível conta antes da primeira coleta.",
    oQueUmaBoaRespostaTem:
      "Em que rede você posta, de quanto em quanto tempo de verdade, o vídeo que mais deu certo e por que você acha que deu.",
  },
  {
    id: "p9",
    rotuloCurto: "suas frases e o tom",
    bloco: 4,
    blocoNome: "Sobre a sua fala",
    peso: 2,
    enunciado:
      "Como você fala de verdade? Escreva três frases que você diz sempre, do jeito que saem, e diga o seu tom: brincalhão, direto, sério, provocador, calmo.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura: "Frases literais com gíria e ritmo, mais o tom nomeado. É o que faz o roteiro soar como ela.",
    oQueUmaBoaRespostaTem:
      "Três frases que você diz sempre, do jeito que saem, e o seu tom em uma palavra: brincalhão, direto, sério, provocador, calmo.",
  },
  {
    id: "p10",
    rotuloCurto: "o que fica fora",
    bloco: 4,
    blocoNome: "Sobre a sua fala",
    peso: 1,
    enunciado:
      "O que você nunca diria, faria ou mostraria num vídeo? Assunto, pessoa, lugar, palavra, e o que da sua vida fica fora da câmera (família, casa, dinheiro, o que for).",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "Limites explícitos. Numa pessoa eles pesam mais que num negócio, porque a vida dela é o conteúdo: entram como proibição dura em todo roteiro.",
    oQueUmaBoaRespostaTem:
      "O que fica fora da câmera: assunto, pessoa, lugar, palavra, e o que da sua vida você não mostra (família, casa, dinheiro, o que for).",
  },
  {
    id: "p11",
    rotuloCurto: "a sua semana na câmera",
    bloco: 5,
    blocoNome: "O seu dia na câmera, referências",
    peso: 2,
    enunciado:
      "Como é a sua semana, e o que dela dá para filmar? Os lugares por onde você passa, com quem trabalha, o que faz com as mãos, viagens, reuniões, treino, o bastidor dos seus negócios ou das suas parcerias. Diga o que pode e o que não pode aparecer.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "Uma lista de cenas filmáveis da vida real dela. É a pergunta que liga o briefing à tese: o roteiro da pessoa empurra o que um clone nunca faz, o lugar de verdade e a pessoa de verdade nele.",
    oQueUmaBoaRespostaTem:
      "Como é a sua semana e o que dela dá para filmar: lugares, pessoas com quem trabalha, o que você faz com as mãos, viagens, treino, bastidor. E o que não pode aparecer.",
  },
  {
    id: "p12",
    rotuloCurto: "perfis parecidos",
    bloco: 5,
    blocoNome: "O seu dia na câmera, referências",
    /** E76 PR 2: a P12 e a P13 pesam 0,5 cada, o peso 1 da P12 antiga dividido entre as duas. */
    peso: 0.5,
    versao: VERSAO_P12_SEPARADA,
    perfisCitados: "concorrente",
    /** E76 PR 2: só os perfis parecidos; os admirados foram para a P13. Os @ ficam na lista acima do campo (V12c, item 7, a E37b). */
    enunciado: "Quais perfis são parecidos com o seu, e o que eles fazem que você faria diferente?",
    enunciadoCampo: "Em uma frase por perfil, o que ele faz que você faria diferente.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "Perfis parecidos com o @ na lista acima do campo e, para cada um, o que a pessoa faria diferente. Os parecidos entram na camada exclusiva de pesquisa no lugar dos concorrentes (uma pessoa não tem concorrente, tem vizinho de assunto).",
    oQueUmaBoaRespostaTem: "Uma frase por perfil parecido com o seu: o que ele faz que você faria diferente. Os @ vão na lista acima.",
  },
  {
    id: "p13",
    rotuloCurto: "perfis que admira",
    bloco: 5,
    blocoNome: "O seu dia na câmera, referências",
    peso: 0.5,
    perfisCitados: "admira",
    /** E76 PR 2: nova, separada da P12. Os @ ficam na lista acima do campo. */
    enunciado: "Quais são os perfis que você admira, e o que gosta em cada um?",
    enunciadoCampo: "Em uma frase por perfil, o que você gosta nele.",
    ajuda: AJUDA_PADRAO_PESSOA,
    oQueAIAProcura:
      "Perfis admirados com o @ na lista acima do campo e, para cada um, do que ela gosta ali: o jeito de falar, de explicar, de mostrar ou de editar. Viram referência de tom.",
    oQueUmaBoaRespostaTem:
      "Uma frase por perfil: o que você gosta em cada um que admira, como o jeito de falar, de contar a própria história ou de editar. Os @ vão na lista acima.",
  },
];

export function perguntasDoBriefing(tipo: TipoMarca): PerguntaBriefing[] {
  return tipo === "pessoa" ? PERGUNTAS_PESSOA : PERGUNTAS_NEGOCIO;
}

export const TOTAL_BLOCOS = 5;

/** Quantas perguntas o briefing tem (o mesmo nos dois tipos): treze desde a E76 PR 2, que separou a P12 em duas. */
export const TOTAL_PERGUNTAS = PERGUNTAS_NEGOCIO.length;

export function perguntaPorId(id: string, tipo: TipoMarca): PerguntaBriefing | undefined {
  return perguntasDoBriefing(tipo).find((p) => p.id === id);
}

export function perguntasDoBloco(bloco: number, tipo: TipoMarca): PerguntaBriefing[] {
  return perguntasDoBriefing(tipo).filter((p) => p.bloco === bloco);
}
