/**
 * Dados fixos (secao 1) e as doze perguntas do briefing (secao 2), copiados
 * literalmente de estrategia/briefing-e-rubricas.md. As telas de /comecar e
 * /briefing leem daqui; nunca reescrever o enunciado ou o "o que a IA
 * procura" na tela ou no servico.
 */

export type PersonaOpcao = { valor: "negocio" | "criador"; rotulo: string };
export type QuemGravaOpcao = { valor: "propria_pessoa" | "pessoa_e_equipe"; rotulo: string };

export const DADOS_FIXOS = {
  nome: { rotulo: "Nome do negócio" },
  cidade: { rotulo: "Cidade" },
  bairro: { rotulo: "Bairro" },
  ramo: {
    rotulo: "Ramo",
    ajuda: "Escolha o que mais se parece com o seu negócio. Se não achar, escolha \"outro\".",
    opcaoOutro: "outro",
  },
  persona: {
    rotulo: "O que você quer com os vídeos",
    opcoes: [
      { valor: "negocio", rotulo: "Vender o meu produto ou serviço" },
      { valor: "criador", rotulo: "Virar criador e atrair marcas" },
    ] satisfies PersonaOpcao[],
  },
  perfis: { rotulo: "Perfis nas redes" },
  quemGrava: {
    rotulo: "Quem grava",
    opcoes: [
      { valor: "propria_pessoa", rotulo: "Eu mesmo" },
      { valor: "pessoa_e_equipe", rotulo: "Eu e a equipe" },
    ] satisfies QuemGravaOpcao[],
  },
};

export type PerguntaBriefing = {
  id: string;
  bloco: number;
  blocoNome: string;
  peso: number;
  enunciado: string;
  ajuda: string;
  oQueAIAProcura: string;
};

const AJUDA_PADRAO = "Escreva como se fosse para alguém que nunca ouviu falar do seu ramo.";

export const PERGUNTAS_BRIEFING: PerguntaBriefing[] = [
  {
    id: "p1",
    bloco: 1,
    blocoNome: "Sobre o negócio",
    peso: 2,
    enunciado:
      "Em poucas palavras, o que o seu negócio faz hoje? Explique como se estivesse falando com alguém que nunca ouviu falar do seu ramo.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      "O que é feito, para quem, e o resultado final na vida da pessoa. Nota alta quando um leigo consegue visualizar a cena.",
  },
  {
    id: "p2",
    bloco: 1,
    blocoNome: "Sobre o negócio",
    peso: 1,
    enunciado:
      "Qual é o produto ou serviço que mais vende, e quanto custa em média? Se puder, diga também o que a pessoa leva junto: o que ela resolve, sente ou evita.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura: "Um item nomeado, um valor ou faixa, e o benefício em linguagem de cliente.",
  },
  {
    id: "p3",
    bloco: 1,
    blocoNome: "Sobre o negócio",
    peso: 1,
    enunciado:
      "O que você faz diferente de quem oferece a mesma coisa perto de você? Conte um caso real em que isso apareceu.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      'Uma diferença que só ele poderia dizer, com história ou número. "Qualidade" e "atendimento humanizado" sem exemplo valem nota média.',
  },
  {
    id: "p4",
    bloco: 2,
    blocoNome: "Sobre quem você atende",
    peso: 1,
    enunciado:
      "Descreva o cliente que você mais gosta de atender: idade, onde mora, o que faz, e em que momento da vida está quando te procura.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura: "Uma pessoa, não um segmento. Momento de vida é o que mais ajuda o gancho.",
  },
  {
    id: "p5",
    bloco: 2,
    blocoNome: "Sobre quem você atende",
    peso: 2,
    enunciado:
      "Qual é a dúvida, o medo ou a desculpa que essa pessoa tem antes de fechar com você? Escreva com as palavras que ela usa.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      "Frases em primeira pessoa do cliente. É a matéria-prima do gancho e do vídeo que vende.",
  },
  {
    id: "p6",
    bloco: 2,
    blocoNome: "Sobre quem você atende",
    peso: 1,
    enunciado:
      "Quais perguntas seus clientes mais repetem no balcão, no WhatsApp ou na consulta? Liste pelo menos cinco.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura: "Perguntas literais. Cada uma vira um tema com chance de gerar cliente.",
  },
  {
    id: "p7",
    bloco: 3,
    blocoNome: "Sobre o que você quer que aconteça",
    peso: 1,
    enunciado:
      "Quando alguém assiste um vídeo seu, o que você quer que aconteça em seguida? Te chamar, agendar, comprar, guardar o seu contato, indicar para alguém?",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      "Uma ação principal e uma secundária. Define a chamada final padrão e a mistura da linha editorial (seção 5).",
  },
  {
    id: "p8",
    bloco: 3,
    blocoNome: "Sobre o que você quer que aconteça",
    peso: 1,
    enunciado:
      "Onde você posta hoje, com que frequência, e o que já aconteceu de bom ou de ruim quando postou?",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      "Rede, ritmo real e um episódio. Um vídeo que já deu certo é evidência de nível conta antes mesmo da primeira coleta.",
  },
  {
    id: "p9",
    bloco: 4,
    blocoNome: "Sobre a sua fala",
    peso: 2,
    enunciado:
      "Como você fala com o cliente no dia a dia? Escreva três frases que você diz de verdade, do jeito que saem.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      "Frases literais, com gíria e ritmo da pessoa. É o que faz o roteiro soar como ele e não como texto de IA.",
  },
  {
    id: "p10",
    bloco: 4,
    blocoNome: "Sobre a sua fala",
    peso: 1,
    enunciado: "O que você nunca diria ou faria num vídeo? Promessa, palavra, tom, assunto, pessoa.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      "Limites explícitos. Entram como proibição dura em todo roteiro e derrubam a nota de encaixe de um tema que os fira.",
  },
  {
    id: "p11",
    bloco: 5,
    blocoNome: "O que dá para mostrar, referências e concorrentes",
    peso: 2,
    enunciado:
      "O que a câmera pode mostrar no seu dia a dia? Local, equipe, equipamento, produto sendo usado, antes e depois, bastidor, cliente (com autorização). Diga o que pode e o que não pode aparecer.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      "Uma lista de cenas filmáveis. É a pergunta que liga o briefing à tese do produto: os roteiros empurram o que um clone não consegue fazer, e isso só funciona se a IA souber o que existe para mostrar.",
  },
  {
    id: "p12",
    bloco: 5,
    blocoNome: "O que dá para mostrar, referências e concorrentes",
    peso: 1,
    enunciado:
      "Cite dois ou três perfis que você admira (com @) e dois ou três concorrentes diretos (nome ou @). Em uma frase, por que cada um.",
    ajuda: AJUDA_PADRAO,
    oQueAIAProcura:
      "Handles válidos. Perfis admirados viram referência de tom; concorrentes entram na camada exclusiva de pesquisa (escopo 5.6).",
  },
];

export const TOTAL_BLOCOS = 5;

export function perguntaPorId(id: string): PerguntaBriefing | undefined {
  return PERGUNTAS_BRIEFING.find((p) => p.id === id);
}

export function perguntasDoBloco(bloco: number): PerguntaBriefing[] {
  return PERGUNTAS_BRIEFING.filter((p) => p.bloco === bloco);
}
