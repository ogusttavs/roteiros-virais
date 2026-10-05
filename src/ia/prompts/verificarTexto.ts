import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Segunda camada do verificador (src/ia/verificador.ts): checagens locais
 * (regex) ja cobrem travessao, emoji e a lista fixa de jargao da secao 8 do
 * brief-frontend.md, entao esta tarefa nao precisa repetir essa lista. Ela
 * cobre o que regex nao pega: tom, naturalidade e as proibicoes do
 * proprio cliente (P10 do briefing), que sao dado por cliente, nunca uma
 * lista fixa.
 *
 * `genero` (rodada de acabamento de 06/09, item 1): o criterio "soa como
 * uma pessoa falando com outra pessoa" so serve pro texto que o cliente
 * grava (roteiro, tema), o genero "padrao" (default, comportamento de
 * antes). A analise de uma resposta do briefing (avaliarResposta) e
 * feedback, nao esse tipo de texto: o proprio prompt dela manda escrever
 * em tom de instrucao ("o que fazer", "o criterio que faltou"), e em
 * producao isso reprovava com "soar como consultoria" quando a resposta
 * do cliente era uma lista, porque o "como melhorar" nasce mais
 * imperativo. O genero "analise" troca esse criterio por um que aceita
 * instrucao clara sem confundir com propaganda de venda.
 *
 * `roteiro` (dia 1 da etapa 14, `PROXIMO.md`, item 5): no primeiro roteiro
 * real da Dr.Wash, a segunda tentativa reprovou dizendo que era um roteiro
 * técnico de produção, não a tela que o dono de negócio vai ver, por isso
 * não dava para avaliar o tom: o modelo barato não reconheceu o próprio
 * gênero, porque o texto inclui um bloco de instrução de edição (o que
 * aparece na tela, o ritmo de corte) que ele leu como roteiro de produção
 * para um editor, não como o texto que o cliente lê e segue sozinho. O
 * genero "roteiro" descreve isso com todas as letras, para nunca mais
 * reprovar por não reconhecer o gênero.
 *
 * `regra` (E27 parte 2, item 7, achado da medição de custo com chave real):
 * a saída de `aprenderCliente` é uma lista de regras curtas e diretas ("não
 * começar com pergunta: comece mostrando"), do mesmo jeito que uma regra de
 * negócio soa, nunca uma frase de conversa. Sem esse gênero, a tentativa com
 * chave real reprovou duas vezes seguidas dizendo que o texto "parece ser
 * instruções internas... não um texto para a tela do dono de negócio", a
 * mesma classe de erro que motivou o gênero "analise": o modelo barato
 * confunde instrução direta e correta com instrução interna. A regra
 * aparece no Briefing do próprio cliente (`AprendizadoCard.tsx`), então é
 * texto de tela sim, só que no formato de regra, não de conversa.
 *
 * `tema` (29/09/2026, achado do Gustavo em produção, na Dr.Wash): a
 * recomendação de `avaliarTema` diz como ajustar o tema antes de gravar (o
 * que mostrar, em que ordem, com que teste), e o modelo barato reprovou duas
 * vezes seguidas dizendo que era "um briefing de direção de gravação, não um
 * texto para o dono do negócio ler" e depois "instruções detalhadas que soam
 * como briefing interno". A mesma classe de erro dos gêneros "roteiro" e
 * "regra": instrução de gravação escrita para o próprio dono é o formato
 * certo desta recomendação, e o verificador precisa saber disso para não
 * transformar uma avaliação boa (nota 8,6) num erro na tela.
 */

/**
 * O roteiro não inventa fato (achado do Bruno e do Gustavo no teste de 04/10/2026: o roteiro do momento trouxe "o Uli está aqui do meu lado com a mochila", "uma mesa de hotel com café
 * já frio", coisas que ninguém contou). Com `fontes`, o verificador confere também que o texto não AFIRMA fato concreto (pessoa, lugar, objeto, número, data, acontecimento) fora delas; um
 * espaço marcado entre colchetes para a pessoa preencher não é fato. Sem `fontes`, nada muda. Versão 1.6.0.
 *
 * 1.7.0 (golden set com chave, 04/10/2026: o 1.6.0 reprovou 7 de 7 momentos, 5 de 5 stories e 21 de 22 roteiros, o que em produção seria `ErroIA` em quase toda geração): o critério era largo
 * demais e reprovava paráfrase ("89 reais" para "R$ 89"), inferência óbvia ("a clínica fica na Vila Sorriso" para "bairro Vila Sorriso, São Paulo"), conhecimento geral do ofício ("esfregar
 * espalha a gordura"), frase de efeito e até hashtag. Agora só conta o fato ESPECÍFICO sobre a pessoa, o negócio, o lugar, o momento ou um acontecimento (quem está junto, onde, o que
 * aconteceu, quando, quanto custa, nome de produto, de cliente, de cidade, uma cena vivida); fora da regra, e nunca motivo de reprovação: conhecimento do ramo, opinião, frase de efeito,
 * generalização, paráfrase, inferência óbvia da fonte e hashtag. Na dúvida, aprova: só reprova quando aponta o fato específico E afirma que nada na fonte o sustenta, e a saída lista o fato
 * (`fatoEspecifico`) e a frase da fonte mais próxima (`fonteMaisProxima`, ou nenhuma). Os exemplos do prompt são os três casos de paráfrase, inferência e ofício (aprovados) e os quatro fatos
 * do achado do Bruno (reprovados). Versão 1.7.0.
 *
 * 1.7.1 (juiz independente sobre os 34 roteiros do golden set, 04/10/2026): o que sobrava era "prática do negócio" inventada ("testo antes de entrar no kit", "anoto a pergunta ao lado de cada
 * fornecedor", "a gente responde uma por uma", "na nossa loja" numa marca sem loja). O fato específico passa a incluir como a pessoa trabalha, o que ela faz ou oferece; o conhecimento geral do
 * ofício continua livre. Versão 1.7.1.
 *
 * 1.7.2 (golden set com chave, depois do 1.7.1): três falsos positivos que sobraram viram exemplos que APROVAM e saem da regra: a instrução de gravação ("gravar parado no sinal ou estacionado" quando o
 * momento diz "no carro, parado no sinal"), a repetição ou paráfrase do TEMA ou do momento (são fonte) e a frase que o cliente pediu para falar ("o que o vídeo precisa comunicar", o pedido). Versão 1.7.2.
 *
 * 1.7.3 (revisão do PR #127, 05/10/2026): ainda reprovava na 1ª tentativa a frase que está literalmente no perfil ("nunca promete resultado", a "Frase que fala" do cliente, que no sem fala é como a frase
 * dita chega às fontes), o espaço marcado entre colchetes ("sempre faço [conte aqui como você faz isso]") e a pergunta (um Story comparando dois produtos foi lido como fato); viram exclusões e exemplos que APROVAM. Versão 1.7.3.
 */
export const versao = "1.7.3";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export type GeneroTexto = "padrao" | "analise" | "roteiro" | "regra" | "tema";

export const schema = z.object({
  aprovado: z.boolean(),
  motivo: z.string().nullable(),
  /** Só na conferência de fatos (com fontes), quando reprova: o fato específico que o texto afirma sem apoio. Nulo nos outros casos. */
  fatoEspecifico: z.string().nullable().catch(null),
  /** Só na conferência de fatos: a frase da fonte mais próxima desse fato, ou "nenhuma". Nulo nos outros casos. */
  fonteMaisProxima: z.string().nullable().catch(null),
});

export type SaidaVerificarTexto = z.infer<typeof schema>;

/** O motivo da reprovação: por fato, leva o fato e a frase das fontes mais próxima (o que a segunda tentativa recebe); senão, o motivo de sempre. */
export function motivoDaConferencia(dados: SaidaVerificarTexto): string {
  if (dados.fatoEspecifico) {
    return `o texto afirma "${dados.fatoEspecifico}" e nada nas fontes o sustenta (fonte mais próxima: ${dados.fonteMaisProxima ?? "nenhuma"})`;
  }
  return dados.motivo ?? "reprovado";
}

const CRITERIO_TOM: Record<GeneroTexto, string> = {
  padrao: "o texto soa como uma pessoa falando com outra pessoa, não como propaganda;",
  analise:
    "o texto é uma análise de feedback sobre uma resposta do cliente: dar instrução clara de " +
    "como melhorar é esperado e correto, não reprove só por isso; reprove apenas se soar como " +
    "propaganda de venda ou usar uma palavra fora do lugar;",
  roteiro: "o texto soa como uma pessoa falando com outra pessoa, não como propaganda;",
  regra:
    "o texto é uma regra curta e direta sobre o que os próximos roteiros deste cliente devem " +
    "seguir ou evitar: frase imperativa, do tipo não fazer X e sim Y, é o formato esperado e " +
    "correto, não reprove só por isso; reprove apenas se soar como propaganda de venda ou usar " +
    "jargão de marketing ou de tecnologia;",
  tema:
    "o texto é a recomendação sobre um tema que o dono do negócio propôs: dizer como ajustar e " +
    "como gravar (o que mostrar, em que ordem, que teste fazer) é esperado e correto, não reprove " +
    "só por isso; reprove apenas se soar como propaganda de venda ou usar jargão de marketing " +
    "ou de tecnologia;",
};

/** Só os generos "roteiro", "regra" e "tema" precisam desta explicação extra; os outros não mudam de comportamento. */
const CONTEXTO_GENERO: Partial<Record<GeneroTexto, string>> = {
  roteiro:
    "\nO texto é um roteiro que o próprio dono do negócio vai gravar sozinho no celular: gancho, " +
    "corpo, fechamento e chamada final, mais um bloco de edição com instruções de tela e de " +
    "corte para ele seguir. Essas instruções de edição são parte do texto que ele lê e segue, " +
    "escritas para ele, não para um editor profissional; nunca reprove achando que não é o " +
    "texto que o cliente vê, isso não é um erro de gênero.\n",
  regra:
    "\nO texto é uma regra que resume o que o cliente já reprovou antes, para lembrar os próximos " +
    "roteiros dele do que evitar. Ela aparece numa lista curta na tela do próprio cliente, no " +
    "briefing, ao lado de outras regras assim. Frase curta e imperativa é o formato certo deste " +
    "gênero, não instrução interna de equipe; nunca reprove achando que parece um manual de " +
    "produção ou uma nota técnica, isso não é um erro de gênero.\n",
  tema:
    "\nO texto é a recomendação que o dono do negócio lê depois de propor um tema: ela diz se vale " +
    "gravar hoje e, quando pede ajuste, sugere o ângulo mais próximo do que já funcionou, com " +
    "instruções de gravação (o que mostrar primeiro, que teste fazer, onde parar) escritas para " +
    "ele seguir sozinho no celular. Instrução de gravação é o formato certo deste gênero, não um " +
    "briefing interno nem direção para uma equipe; nunca reprove achando que não é o texto que o " +
    "cliente vê, isso não é um erro de gênero.\n",
};

/**
 * A definição estreita de "fato que precisa de fonte" (1.7.0). Os exemplos são os sete casos do golden set com chave: três que o 1.6.0 reprovou e NÃO são fato (paráfrase, inferência, ofício) e os
 * quatro fatos do achado do Bruno, que são. Exportada para o teste conferir o texto.
 */
export const CRITERIO_FATOS =
  "\n- o texto não afirma, como real, um fato ESPECÍFICO que as FONTES (depois do texto) não sustentam. Fato específico é o que diz respeito à pessoa, ao negócio, ao lugar, ao momento ou a " +
  "um acontecimento: quem está junto, onde está, o que aconteceu, quando, quanto custa, nome de produto, de cliente ou de cidade, uma cena vivida, e também COMO A PESSOA TRABALHA e o que ela " +
  "faz ou oferece (\"respondo no direct\", \"testo na mão antes\", \"anoto a pergunta de cada fornecedor\", \"tenho loja\", \"na nossa loja\", \"a gente responde uma por uma\"): uma prática do " +
  "negócio que as fontes não trazem é invenção, mesmo parecendo detalhe inocente. NÃO é fato que precise de fonte, e nunca é " +
  "motivo de reprovação: conhecimento geral do ramo (como a gordura espalha, o que mancha o dente), opinião, frase de efeito (\"o passo que quase todo mundo pula\"), generalização (\"muita " +
  "gente\"), paráfrase ou reformulação de algo que está nas fontes (o mesmo número escrito de outro jeito, o mesmo lugar dito de outro jeito), inferência óbvia das fontes (clínica em um bairro " +
  "\"fica\" nesse bairro), repetir ou reformular o TEMA ou o momento (eles são fonte), a frase ou o assunto que o cliente pediu para dizer (\"o que o vídeo precisa comunicar\", o pedido), " +
  "hashtags, instruções de gravação (sugerir como ou onde gravar, mesmo mudando um detalhe do que o momento diz), perguntas (uma pergunta, mesmo comparando dois produtos, não afirma nada), frase que está " +
  "literalmente nas fontes (o perfil traz \"nunca promete resultado\", \"Frase que fala: ...\" e o texto a repete) e o jeito de falar. Um espaço marcado entre colchetes para a pessoa preencher (\"[diga aqui onde você está]\") não é fato, é o " +
  "certo quando a fonte não traz a informação. NA DÚVIDA, APROVE. Só reprove por fato quando você consegue apontar o fato específico E afirmar que nada nas fontes o sustenta; nesse caso " +
  "preencha fatoEspecifico com o fato, fonteMaisProxima com a frase das fontes mais próxima dele (ou \"nenhuma\") e o motivo em uma frase.\n" +
  "  Exemplos que APROVAM: as fontes dizem \"R$ 89\" e o texto diz \"89 reais\"; as fontes dizem \"bairro Vila Sorriso, São Paulo\" e o texto diz \"a clínica fica na Vila Sorriso\"; o texto diz " +
  "\"esfregar a mancha espalha a gordura\" (conhecimento do ofício); o momento diz \"no carro, parado no sinal\" e o texto manda \"gravar parado no sinal ou estacionado\" (instrução de gravação); " +
  "o tema é \"o sofá da cliente de ontem\" e o texto diz \"o sofá da cliente de ontem\"; o tema é \"o erro que apareceu em todo vídeo da semana\" e o texto diz \"você viu esse erro em vídeo atrás de " +
  "vídeo\" (repetição ou paráfrase do tema); o cliente pediu para comunicar \"o horário mudou\" e o texto diz que o horário mudou (a frase que ele pediu para falar); o perfil diz \"nunca promete resultado que não pode cumprir\" e o texto diz " +
  "\"eu nunca prometo resultado\"; o perfil traz \"Frase que fala: aqui a gente aplica igual fábrica, sem bolha\" e o texto diz essa frase (frase do cliente que está no perfil); o texto diz \"sempre faço " +
  "[conte aqui como você faz isso]\" (o espaço marcado entre colchetes não afirma nada); o texto pergunta \"qual dura mais, o produto A ou o B?\" (pergunta, não afirmação).\n" +
  "  Exemplos que REPROVAM, quando as fontes não os trazem: \"o Uli está aqui do meu lado com a mochila nas costas\"; \"numa mesa de hotel com café já frio\"; \"um país quase caiu do roteiro " +
  "porque a feira repetia o que vejo no Brasil\"; \"uma parada ganhou dois dias a mais por causa da fábrica\"; \"testo antes de entrar no kit\" ou \"na nossa loja\" (prática ou loja que o " +
  "perfil não traz);"

export function montarSistemaEstavel(genero: GeneroTexto = "padrao", comFontes = false): string {
  return `Você confere um texto que vai para a tela de um dono de pequeno negócio. Aprove só
se:
- o tom é direto, calmo e de parceiro, sem exclamação e sem entusiasmo forçado;
- ${CRITERIO_TOM[genero]}${comFontes ? CRITERIO_FATOS : ""}
- nenhuma proibição que o cliente listou no briefing foi ferida.
${CONTEXTO_GENERO[genero] ?? ""}
Reprove e diga o motivo em uma frase, sem travessão, quando alguma dessas coisas falhar.
Não repita o texto inteiro na resposta, só o motivo.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { texto: string; proibicoes: string[]; fontes?: string }): string {
  const listaProibicoes =
    dados.proibicoes.length > 0 ? dados.proibicoes.join("; ") : "nenhuma proibicao registrada";
  const blocoFontes = dados.fontes ? `\n\nFONTES (tudo o que foi dito ou escrito para este texto; só isto vale como fato):\n${dados.fontes}` : "";

  return `Texto a conferir:\n${dados.texto}\n\nProibicoes do cliente: ${listaProibicoes}${blocoFontes}`;
}
