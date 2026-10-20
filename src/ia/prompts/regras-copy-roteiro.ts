/**
 * GERADO por `npm run gerar:regras-copy-roteiro` a partir da seção 11 de
 * `estrategia/briefing-e-rubricas.md`. NÃO editar à mão: troque o documento e gere de novo
 * (o teste `regras-copy-roteiro.test.ts` reprova se os dois divergirem).
 *
 * E50 parte 2 (20/10/2026): as 53 regras de copy (R-COPY, 25), de estrutura de roteiro (R-ROTEIRO, 19)
 * e de conformidade (R-CONF, 9). `texto` é o que o prompt recebe; `porQue` é a frase para a pessoa,
 * que a tela mostrará por código (PR 3), nunca escrita pelo modelo.
 */

export const versao = "1.1.0";

export type RegraCopyRoteiro = {
  numero: string;
  grupo: "COPY" | "ROTEIRO" | "CONF";
  /** A coluna "O que diz (como o prompt recebe)". */
  texto: string;
  /** A coluna "Por quê (para a pessoa)". */
  porQue: string;
  /** A coluna "Bloco", como está no documento ("gancho, corpo", "todos"...). */
  bloco: string;
  forca: "forte" | "media" | "indicio";
  forcaNoDocumento: string;
  conferePorCodigo: "sim" | "so_avisa" | "parcial" | "nao";
  confereNoDocumento: string;
  /** A coluna "Fonte"; a prova no banco (coluna seguinte) fica só no documento, é número interno. */
  fonte: string;
};

export const REGRAS_COPY_ROTEIRO: RegraCopyRoteiro[] = [
  {
    "numero": "R-COPY-01",
    "grupo": "COPY",
    "texto": "Escreva para uma pessoa só, o cliente típico da ficha, como se contasse a ele na loja: \"você\" no singular, nunca \"pessoal\", \"galera\", \"turma\". Dirigir-se a \"você\" no gancho é permitido, não é exigido.",
    "porQue": "Quem assiste sente que você fala com ele, não com uma plateia.",
    "bloco": "todos",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (lista de vocativos coletivos; \"você\" no gancho nunca reprova)",
    "fonte": "SA-01, SA-02 (SA:297-303, 454-468); F05-6 (B, n04). A voz está em `R-FALA-11`"
  },
  {
    "numero": "R-COPY-02",
    "grupo": "COPY",
    "texto": "Palavras de conversa, as que o cliente do ramo usa: sem adjetivo empilhado, sem frase de efeito, sem tom de propaganda. Termo técnico, sigla e nome interno só com explicação de poucas palavras na primeira vez.",
    "porQue": "Se a pessoa entende de primeira, ela continua a ver.",
    "bloco": "todos",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (lista de palavras de propaganda; adjetivos por frase; termo técnico do ramo sem explicação na mesma frase)",
    "fonte": "SA-03, MH-03, AR-06, AR-07, AR-08 (SA:347-352, 365-368; MH:1422-1432; AR:5688-5694, 5710-5716, 5862-5870); F24-3 (B, n17); F01-1 a F01-3 (B, n01); regra 6 do `CLAUDE.md`"
  },
  {
    "numero": "R-COPY-03",
    "grupo": "COPY",
    "texto": "Frases faladas de 15 a 20 palavras no máximo, com fim à vista, do tamanho de um fôlego; a que não cabe é quebrada em duas. A medida é aproximada.",
    "porQue": "Frase curta cabe num fôlego e é fácil de falar e de entender.",
    "bloco": "corpo, frases na tela",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "so_avisa",
    "confereNoDocumento": "só avisa, nunca reprova (palavras por frase; a quebra para respirar é de `R-FALA-04`)",
    "fonte": "F24-2 (B, n17); F05-8 (B, n04); AR-12 (AR:6255-6266, 6283-6311)"
  },
  {
    "numero": "R-COPY-04",
    "grupo": "COPY",
    "texto": "Quem fala é a pessoa, com nome, rosto e um jeito de falar que se mantém de vídeo para vídeo; fala com orgulho do que faz, não como \"a empresa\". O jeito é o tom, nunca a abertura: o roteiro sem vício de abertura (decisão de 19/09/2026) continua valendo.",
    "porQue": "Quem vê aprende a reconhecer você pelo jeito, e confia mais em quem já conhece.",
    "bloco": "todos",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "nao",
    "confereNoDocumento": "não",
    "fonte": "SA-20, SA-23, MH-10 (SA:3408-3436, 1184-1196; MH:6975-6980). Casa com `R-TT-VIDEO-11`"
  },
  {
    "numero": "R-COPY-05",
    "grupo": "COPY",
    "texto": "O gancho chama quem interessa: nomeia a pessoa, a situação ou o problema que ela já reconhece, sem tentar atrair todo mundo. Antes de escrever, o roteiro declara o estado de quem vai ver (\"ainda não nomeia o problema\" ou \"já procura solução\"). Para quem não procura (o padrão em Reels, TikTok e Short), preço, nome de produto e \"promoção\" ficam depois do gancho; para quem já procura, vá direto à diferença e à condição.",
    "porQue": "O começo fala do que a pessoa já sente; só depois mostra o que você vende.",
    "bloco": "gancho, corpo",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (campo \"quem vai ver\"; se \"ainda não nomeia\", o gancho não contém preço nem palavra de oferta; o gancho contém um termo da ficha ou do ramo)",
    "fonte": "SA-05, SA-22, AR-14 (SA:937-946, 1115-1118, 1258-1264; AR:6997-7000); F04-1 a F04-3 (B, n03); F07-1 (A, n05)"
  },
  {
    "numero": "R-COPY-06",
    "grupo": "COPY",
    "texto": "O gancho fala do ganho de quem vê, nem que implícito; gancho que só fala de quem grava (\"aqui na nossa empresa...\") não vale. Quando o motor é a novidade, ela é verdadeira e se entende na hora: nem óbvia, nem obscura.",
    "porQue": "Quem assiste só fica se achar que vai ganhar alguma coisa.",
    "bloco": "gancho",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o gancho não abre em primeira pessoa institucional: \"nós\", \"aqui na empresa\")",
    "fonte": "F06-3, F06-4 (A, n05); F05-4 (B, n04); AR-09 (AR:6414-6440)"
  },
  {
    "numero": "R-COPY-07",
    "grupo": "COPY",
    "texto": "Quando o tema é do momento (E55) ou notícia, o primeiro bloco diz o que mudou e quando (\"hoje\", \"esta semana\", a data), com a fonte que a E55 já exige. Tema que não é novo não finge novidade.",
    "porQue": "Se é notícia, diga o que mudou e quando.",
    "bloco": "gancho",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (tema do tipo momento ou notícia exige marcador de tempo no gancho)",
    "fonte": "F06-3 (A, n05; fonte fraca para vídeo). Liga-se à E55"
  },
  {
    "numero": "R-COPY-08",
    "grupo": "COPY",
    "texto": "Fato específico no lugar de superlativo: número, prazo, quantidade, nome. Nada de \"o melhor\", \"qualidade\", \"tudo\". O número vem da ficha ou do momento (`R-CONF-02`). O número no gancho é pedido por `R-TT-VIDEO-07` e `R-YT-SHORT-05`.",
    "porQue": "Um número ou um nome real parece verdade; \"o melhor\" não diz nada.",
    "bloco": "gancho, corpo",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (sem os superlativos da lista; pelo menos um número ou nome próprio no gancho ou no corpo)",
    "fonte": "SA-08 (SA:1406-1414, 1433-1451, 1501-1518); F06-4 (A, n05)"
  },
  {
    "numero": "R-COPY-09",
    "grupo": "COPY",
    "texto": "Vá ao que a pessoa já sente e já procura: a dor de hoje e o tema que já sobe vêm primeiro; prevenção entra como segunda razão; o vídeo não gasta o tempo explicando por que o assunto importa. A dica e a instrução continuam valendo (`R-IG-REEL-03`).",
    "porQue": "A pessoa age para resolver o que já incomoda, e raramente para evitar o que ainda não aconteceu.",
    "bloco": "gancho, corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o gancho não é uma explicação do problema)",
    "fonte": "SA-12, SA-13 (SA:2077-2083, 2097-2104, 1959-1990, 2042-2056). Hopkins fala de anúncio pago de resposta direta"
  },
  {
    "numero": "R-COPY-10",
    "grupo": "COPY",
    "texto": "O nome do negócio (ou da pessoa) e o lugar (bairro, cidade) aparecem na fala ou na tela pelo menos uma vez. No Instagram e no TikTok: só de forma leve no gancho, nunca antes de dizer o assunto, e claro na tela ou no fim. No YouTube: cedo.",
    "porQue": "Quem gostou precisa saber quem é você e onde achar, mas sem atrasar o assunto.",
    "bloco": "frases na tela, chamada (gancho no YouTube)",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim para a presença do nome; parcial para a posição (nome fora das primeiras palavras no Instagram e no TikTok)",
    "fonte": "F20-2 (A, n14, vendedor); F21-5 (A, n15, vendedor); F22 (C, n16, só convergência)"
  },
  {
    "numero": "R-COPY-11",
    "grupo": "COPY",
    "texto": "Dê mais de um gancho para a mesma ideia, de ângulos diferentes. O sistema não sabe qual vence; quem decide é a medida depois de postar.",
    "porQue": "Você escolhe o que combina com você, e a curva mostra depois o que funcionou.",
    "bloco": "gancho",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (pelo menos dois ganchos de ângulos diferentes)",
    "fonte": "SA-06, SA-18, MH-09 (SA:1031-1035, 1092-1097, 3073-3086; MH:7412-7417). Casa com \"outro ângulo\""
  },
  {
    "numero": "R-COPY-12",
    "grupo": "COPY",
    "texto": "Escreva para o que o cliente quer, não para o que o dono gosta; ancore na ficha e nos vídeos do setor.",
    "porQue": "O que você acha bonito pode não ser o que o seu cliente quer ouvir.",
    "bloco": "todos",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "nao",
    "confereNoDocumento": "não (o prompt já ancora; o verificador confere a citação do vídeo)",
    "fonte": "SA-17, MH-02 (SA:471-488, 2239-2251; MH:1358-1368)"
  },
  {
    "numero": "R-COPY-13",
    "grupo": "COPY",
    "texto": "No máximo duas ou três razões ou passos de raciocínio por vídeo, escolhidos entre os mais fortes; omita o que o espectador já sabe. Um assunto só (`R-IG-REEL-02`) vence a ideia de contar tudo.",
    "porQue": "Vídeo curto não aguenta tudo; melhor pouca coisa bem entendida.",
    "bloco": "corpo",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (afirmações encadeadas por vídeo)",
    "fonte": "AR-04, AR-05 (AR:510-514, 527-539); SA-14 (SA:1577-1623, 1651-1675), limitada pela plataforma"
  },
  {
    "numero": "R-COPY-14",
    "grupo": "COPY",
    "texto": "Um fato verdadeiro, concreto e inesperado do trabalho, mostrado, para dar curiosidade. Peça ao dono o que acontece no bastidor que ele acha banal.",
    "porQue": "O que parece banal para você costuma ser novidade para quem vê.",
    "bloco": "corpo, o que mostrar",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o campo \"o que mostrar\" traz um fato do momento ou da ficha)",
    "fonte": "SA-10, MH-05, MH-06 (SA:1141-1150; MH:6929-6953, 6982-6998)"
  },
  {
    "numero": "R-COPY-15",
    "grupo": "COPY",
    "texto": "Demonstre: o produto ou o serviço fazendo o que promete, na câmera, em vez de descrever; diga ao espectador o que olhar.",
    "porQue": "Ver funcionando convence mais do que ouvir falar.",
    "bloco": "corpo, o que mostrar",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (algum bloco \"mostrar\" traz uma ação de demonstração)",
    "fonte": "MH-01, SA-24 (MH:1168-1179, 1198-1218; SA:1318-1322); F20-5 (A, n14); F18-6 (A, n12)"
  },
  {
    "numero": "R-COPY-16",
    "grupo": "COPY",
    "texto": "Toda imagem mostra algo que a fala afirma; nada só para chamar atenção. Onde a seção 9 pede a cena inesperada (`R-IG-STORY-02`) ou a primeira imagem forte, a seção 9 manda.",
    "porQue": "Imagem que não tem a ver com o que você diz distrai e some a mensagem.",
    "bloco": "o que mostrar",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (cada \"mostrar\" liga a uma frase)",
    "fonte": "SA-19 (SA:1760-1771, 1820-1845)"
  },
  {
    "numero": "R-COPY-17",
    "grupo": "COPY",
    "texto": "Fale no presente e em ação: o que a pessoa fez e o efeito, com verbos de movimento e cena acontecendo, em vez de resumo abstrato ou lista de qualidades.",
    "porQue": "Quem vê acompanha melhor o que está acontecendo agora do que uma explicação.",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (verbo de ação nas frases do corpo)",
    "fonte": "AR-11 (AR:6448-6451, 6527-6536); FT-01, FT-02 (FT:1389-1394, 1421-1424, 1431-1433); PO-01 (PO:387-416)"
  },
  {
    "numero": "R-COPY-18",
    "grupo": "COPY",
    "texto": "Se usar comparação, que seja simples, de coisa conhecida e do mesmo assunto, entendida de pronto; nada de enfeite nem pilha de adjetivos.",
    "porQue": "Uma comparação boa explica em um segundo; uma rebuscada confunde.",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "nao",
    "confereNoDocumento": "não",
    "fonte": "AR-08 (AR:5744-5750, 5790-5792, 6446-6448)"
  },
  {
    "numero": "R-COPY-19",
    "grupo": "COPY",
    "texto": "Quando couber, uma frase em duas metades que se opõem (antes e depois, esperado e real, caro e barato).",
    "porQue": "O contraste se grava na cabeça.",
    "bloco": "gancho, corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (frase com duas metades paralelas)",
    "fonte": "AR-10 (AR:6339-6345, 6442-6445)"
  },
  {
    "numero": "R-COPY-20",
    "grupo": "COPY",
    "texto": "A credibilidade se faz dentro do vídeo, mostrando mais do que declarando: o trabalho à vista, um número ou fato da ficha, a franqueza sobre o limite e a vontade de ajudar quem assiste. Quando houver prova concreta (cena, número ou caso real), use-a junto da afirmação.",
    "porQue": "A pessoa confia no que vê você fazendo, mais do que no que você diz de si.",
    "bloco": "corpo",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (algum bloco mostra o trabalho ou um número da ficha)",
    "fonte": "AR-01, AR-02, AR-04 (AR:418-445, 429-435, 478-491, 2864-2881); SA-09 (SA:1410-1416, 2297-2319); F08-3 (B, n06)"
  },
  {
    "numero": "R-COPY-21",
    "grupo": "COPY",
    "texto": "Nunca prova genérica: \"milhões\", \"estudos mostram\", \"todo mundo faz\", \"a maioria\" sem número e fonte. Dado de gente parecida (mesmo ramo ou bairro) só se estiver na ficha ou no momento, com a referência mais próxima possível; usar é opção, não obrigação.",
    "porQue": "Frase vaga como \"todo mundo faz\" soa falsa; um fato verdadeiro e próximo soa honesto.",
    "bloco": "corpo, chamada",
    "forca": "indicio",
    "forcaNoDocumento": "indício (banco: 28 vídeos, menos de 30; decisão do Fable de 20/10/2026, o banco manda pela precedência da 11.0)",
    "conferePorCodigo": "so_avisa",
    "confereNoDocumento": "só avisa, nunca reprova (lista de expressões genéricas sem fonte da ficha ou da E54; o número citado precisa existir na ficha ou no momento)",
    "fonte": "F09-1, F09-2 (A, n06); F08-6 (B, n06); F26-3, F26-9 (A, n19)"
  },
  {
    "numero": "R-COPY-22",
    "grupo": "COPY",
    "texto": "O roteiro declara a emoção que quer provocar e escolhe uma que mexe: espanto e graça estão liberados; indignação só contra o problema, nunca contra pessoa, concorrente ou grupo; medo só com o limite de `R-CONF-06`. Evite o tom de lamento e de resignação.",
    "porQue": "Espanto, graça e revolta com motivo são o que as pessoas repassam; lamento não.",
    "bloco": "gancho, corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o campo \"emoção\" não pode ser da lista das que desativam; ataque a pessoa, concorrente ou grupo reprova por lista; a emoção em si o modelo julga)",
    "fonte": "F15-1 a F15-3 (A, n10; artigos de jornal, não vídeo); F18-9 (A, n12); AR-03 (AR:2849-2863); SA-11 (SA:3501-3510)"
  },
  {
    "numero": "R-COPY-23",
    "grupo": "COPY",
    "texto": "Sem se gabar e sem atacar concorrente nem cliente. Comparação só com prova objetiva do mesmo nível (`R-CONF-02`).",
    "porQue": "Quem se gaba perde a confiança; mostrar o lado bom do trabalho convence mais.",
    "bloco": "todos",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (lista de ataque e de autoelogio)",
    "fonte": "SA-21 (SA:464-466, 3472-3476); F26-13 (A, n19)"
  },
  {
    "numero": "R-COPY-24",
    "grupo": "COPY",
    "texto": "O vídeo termina no ganho que a pessoa quer: o problema entra como ponto de partida breve e o final não é a ameaça. Antes e depois é permitido e pedido na seção 9 (`R-IG-REEL-04`, `R-YT-SHORT-05`); o que a regra pede é que o vídeo acabe no lado bom.",
    "porQue": "A pessoa guarda a imagem do resultado, e é isso que ela quer para si.",
    "bloco": "corpo, fechamento",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o fechamento não contém palavra de ameaça da lista)",
    "fonte": "SA-11 (SA:3479-3484, 3501-3507, 3520-3530); MH (MH:7313-7330)"
  },
  {
    "numero": "R-COPY-25",
    "grupo": "COPY",
    "texto": "O pedido final é uma só ação, a mais fácil, no canal que a pessoa já usa (mensagem, ligação, visita), e oferece algo antes de mandar comprar (resposta, passo, orçamento, visita). Motivo para agir agora (vaga, horário, prazo) só se for real (`R-CONF-01`). Qual verbo cada plataforma e cada objetivo pedem é da seção 9 (`R-IG-REEL-08`, `R-TT-VIDEO-10`, `R-YT-SHORT-07`, `R-IG-STORY-04` e `-07`).",
    "porQue": "Quanto mais fácil o pedido, mais gente responde; um pedido só não confunde.",
    "bloco": "chamada",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (uma chamada; um canal; \"compre\" não é o único verbo)",
    "fonte": "SA-07, SA-15, SA-16, MH-04 (SA:526-545, 556-559, 738-756, 2673-2677, 2712-2725, 3644-3660; MH:3551-3561); F08-1, F08-4 (B, n06); F20-4 (A, n14)"
  },
  {
    "numero": "R-ROTEIRO-01",
    "grupo": "ROTEIRO",
    "texto": "O vídeo é um todo: começo, meio e fim, e não começa nem acaba ao acaso. Tudo o que o gancho abre, o fim fecha; nada de promessa sem entrega.",
    "porQue": "Quem vê quer chegar ao fim sabendo que o prometido no começo foi cumprido.",
    "bloco": "todos",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (gancho, corpo e fechamento preenchidos); parcial para a promessa do gancho reaparecer no fechamento",
    "fonte": "PO-02, PO-09 (PO:453-463, 950-955, 974-977)"
  },
  {
    "numero": "R-ROTEIRO-02",
    "grupo": "ROTEIRO",
    "texto": "Corte o que, tirado, não muda nada: frase, plano, enfeite.",
    "porQue": "O que não faz diferença só cansa quem assiste.",
    "bloco": "todos",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o verificador pergunta ao modelo qual bloco é removível)",
    "fonte": "PO-04 (PO:507-513)"
  },
  {
    "numero": "R-ROTEIRO-03",
    "grupo": "ROTEIRO",
    "texto": "O assunto e o conflito (o problema, a dúvida ou a promessa) estão no primeiro bloco: uma frase de chão e logo a primeira virada, sem prólogo de outro tom nem preâmbulo. Em que segundo isso acontece é da seção 9: 2 segundos no Reels (`R-IG-REEL-01`), 3 no TikTok (`R-TT-VIDEO-01`), os primeiros no Short (`R-YT-SHORT-02`), 30 no vídeo longo (`R-YT-VIDEO-01`). Aqui só vale \"o assunto cedo\".",
    "porQue": "Nos primeiros segundos a pessoa decide se fica; diga logo do que se trata.",
    "bloco": "gancho",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o gancho contém tensão ou promessa; palavras do bloco de abertura)",
    "fonte": "FT-03, FT-05, FT-06, FT-07, AR-13 (FT:5431-5434, 5813-5819, 5952-5957, 5985-5990, 6161-6166; AR:6951-6955, 6973-6976)"
  },
  {
    "numero": "R-ROTEIRO-04",
    "grupo": "ROTEIRO",
    "texto": "O assunto e o que a pessoa leva aparecem em até 6 segundos de fala (cerca de 15 palavras a 2,5 por segundo), e a primeira frase tem até 12 palavras. São referências, não limites. Onde a seção 9 pede mais cedo, a seção 9 manda.",
    "porQue": "Em poucos segundos a pessoa tem de saber do que se trata e o que vai ganhar.",
    "bloco": "gancho",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "so_avisa",
    "confereNoDocumento": "só avisa, nunca reprova (palavras do primeiro bloco e da primeira frase; o termo do tema aparece nelas)",
    "fonte": "F21-2, F21-3 (A, n15, vendedor); F20-1 (A, n14, vendedor); F05-2, F05-6 (B, n04); F01-2 (B, n01). Os números 6 e 12 são do vendedor ou nossos"
  },
  {
    "numero": "R-ROTEIRO-05",
    "grupo": "ROTEIRO",
    "texto": "Quando o ângulo permite, o gancho abre uma curiosidade com pergunta específica, que a pessoa percebe que não sabe responder e cuja resposta lhe importa (\"qual dos três erros estraga mais o vidro?\"), e a resposta chega no corpo ou no fechamento do mesmo vídeo. Pergunta vaga (\"quer saber o segredo?\") e lacuna que o vídeo não fecha são proibidas; não prometa que a pergunta \"fica na cabeça\". Gancho sem pergunta não reprova.",
    "porQue": "Uma pergunta que a pessoa quer ver respondida a faz ficar até o fim.",
    "bloco": "gancho, corpo, fechamento",
    "forca": "forte",
    "forcaNoDocumento": "forte (banco)",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o gancho com pergunta cita objeto ou cena concreta; a resposta aparece no corpo ou no fim; a lista de iscas vagas reprova)",
    "fonte": "F16-1 a F16-4 (A, n11); F05-4 (B, n04); F17-1 a F17-3 (A, n11: o efeito de \"fica aberto, fica na memória\" não se confirma); PO-09 (PO:950-955). A pergunta genérica já é vetada em `R-IG-REEL-01`"
  },
  {
    "numero": "R-ROTEIRO-06",
    "grupo": "ROTEIRO",
    "texto": "O roteiro registra o tipo de abertura, numa lista fechada (suspense, surpresa, emoção, benefício, novidade, número, prova), e o motor que entrega (benefício para quem vê, novidade verdadeira, curiosidade específica, jeito mais fácil ou rápido com número ou prazo reais). A lista é a calibrar.",
    "porQue": "Saber que tipo de começo você usou ajuda a ver, depois, o que funciona para você.",
    "bloco": "gancho",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "so_avisa",
    "confereNoDocumento": "só avisa, nunca reprova (campo com valor da lista)",
    "fonte": "F21-4 (A, n15, vendedor); F06-3 (A, n05); F20-1 (A, n14); F05-4 (B, n04); F03-1 (C, n02, só convergência)"
  },
  {
    "numero": "R-ROTEIRO-07",
    "grupo": "ROTEIRO",
    "texto": "Cada frase existe para levar à próxima, terminando num \"porque\", num \"e aí\" ou num número que será explicado; nenhuma frase fecha a ideia inteira antes do fechamento; a primeira frase deixa motivo para ouvir a segunda. Entre os blocos, causa e efeito (\"porque\", \"então\"), nunca lista solta.",
    "porQue": "Cada frase puxa a próxima, e a pessoa não consegue sair no meio.",
    "bloco": "corpo",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (conectivo ou promessa no fim das frases do corpo, menos a última; a calibrar)",
    "fonte": "PO-06 (PO:555-560); F05-1, F05-2, F05-3, F05-7 (B, n04); F18-2, F18-3 (A, n12)"
  },
  {
    "numero": "R-ROTEIRO-08",
    "grupo": "ROTEIRO",
    "texto": "Cada bloco traz algo mais específico que o anterior. O momento mais forte (a prova, o resultado, a virada) é marcado no roteiro (\"momento forte\"), tem mais tempo e mais imagem, e vem antes do último bloco, que é o pedido. Onde a seção 9 manda o melhor momento cedo (`R-YT-SHORT-03`, `R-YT-VIDEO-02`), ele vem cedo.",
    "porQue": "O melhor da história não pode ficar escondido; o roteiro mostra onde está.",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (campo \"momento forte\" preenchido e antes do último bloco)",
    "fonte": "FT-04, FT-08, FT-09 (FT:5683-5730, 6317-6324, 6326-6331, 6343-6347); F19-1, F19-2 (A, n13; experimento de dor, a transferência é hipótese); F20-4 (A, n14)"
  },
  {
    "numero": "R-ROTEIRO-09",
    "grupo": "ROTEIRO",
    "texto": "Sempre que houver, uma virada ou descoberta (\"eu achava X, descobri Y\"), ligada a causa e efeito: a surpresa tem motivo. A virada vem antes do fechamento (`R-TT-VIDEO-02`).",
    "porQue": "Uma surpresa com motivo prende; uma sem motivo parece truque.",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (bloco de virada preenchido, antes do fechamento)",
    "fonte": "PO-07, PO-08 (PO:562-571, 593-619); F11-3 (B, n08)"
  },
  {
    "numero": "R-ROTEIRO-10",
    "grupo": "ROTEIRO",
    "texto": "Em vídeo acima de 30 segundos, um reaviso no meio (\"olha o que muda agora\") que renova a atenção.",
    "porQue": "No meio do vídeo a atenção afrouxa; um aviso a traz de volta.",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o bloco do meio traz marcador de virada)",
    "fonte": "AR-15 (AR:7010-7025); F11-3 (B, n08)"
  },
  {
    "numero": "R-ROTEIRO-11",
    "grupo": "ROTEIRO",
    "texto": "Um episódio e uma ideia por vídeo, não a trajetória inteira. O roteiro traz \"a ideia em uma frase\" que a pessoa leva.",
    "porQue": "Uma coisa bem dita é mais lembrada do que muitas ditas por cima.",
    "bloco": "todos",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (campo \"a ideia em uma frase\"; um assunto só)",
    "fonte": "PO-02, PO-03, PO-10 (PO:453-463, 465-477, 979-986); F13-2 (B, n08); F20-3 (A, n14). Concorda com `R-IG-REEL-02` e `R-TT-VIDEO-02`"
  },
  {
    "numero": "R-ROTEIRO-12",
    "grupo": "ROTEIRO",
    "texto": "O exemplo é o de uma pessoa como o cliente, reconhecível, não um caso raro.",
    "porQue": "A pessoa se vê na cena e pensa \"isso é para mim\".",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (o caso cita a ficha ou o ramo)",
    "fonte": "PO-05 (PO:520-532)"
  },
  {
    "numero": "R-ROTEIRO-13",
    "grupo": "ROTEIRO",
    "texto": "O corpo responde, na ordem, às duas ou três perguntas que o espectador faria logo depois do gancho (\"quanto custa?\", \"funciona mesmo?\", \"e se der errado?\"). O roteiro lista a dúvida principal e onde ela é respondida.",
    "porQue": "Quem vê tem dúvidas na cabeça; responder cedo evita que saia.",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (campo \"dúvida principal\" preenchido; a resposta está no corpo)",
    "fonte": "F05-7 (B, n04); F04-2 (B, n03). Liga-se ao \"O que vão te responder\" da E54"
  },
  {
    "numero": "R-ROTEIRO-14",
    "grupo": "ROTEIRO",
    "texto": "O vídeo termina com um pedido. O último bloco traz uma ação clara (`R-COPY-25`) e não é encerramento vazio (\"então é isso\", \"obrigado por assistir\"). O verbo certo por plataforma e por objetivo é o da seção 9.",
    "porQue": "Quem não é convidado a fazer algo vai embora sem fazer.",
    "bloco": "fechamento, chamada",
    "forca": "forte",
    "forcaNoDocumento": "forte (banco)",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (o último bloco não começa com lista de encerramentos vazios e contém verbo de ação ou pergunta ao espectador)",
    "fonte": "F19-1, F19-2 (A, n13; hipótese de transferência); F20-4 (A, n14); SA-07, SA-15 (SA:526-545, 738-756); AR-16 (AR:6874-6877). Casa com `R-IG-STORY-07`"
  },
  {
    "numero": "R-ROTEIRO-15",
    "grupo": "ROTEIRO",
    "texto": "O fechamento é curto e afirmativo, uma ou duas frases, e não recapitula tudo; em vídeo curto o epílogo é dispensável. Termina no resultado (`R-COPY-24`).",
    "porQue": "O fim curto deixa a ideia ficar e o pedido aparecer sem rodeio.",
    "bloco": "fechamento",
    "forca": "media",
    "forcaNoDocumento": "média",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (palavras do fechamento; teto a calibrar)",
    "fonte": "AR-16, AR-17 (AR:6874-6877, 7561-7564). Casa com `R-FALA-09` (o tom desce na chamada)"
  },
  {
    "numero": "R-ROTEIRO-16",
    "grupo": "ROTEIRO",
    "texto": "Em vídeo com história, cerca de um quarto das palavras para a abertura, metade para o desenvolvimento e um quarto para a resolução. É hipótese.",
    "porQue": "O miolo é a parte maior; a abertura e o fim ficam curtos.",
    "bloco": "gancho, corpo, fechamento",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "so_avisa",
    "confereNoDocumento": "só avisa, nunca reprova (palavras por bloco)",
    "fonte": "F12-1 (B, n08): proporção de roteiro de filme, sem prova para vídeo curto"
  },
  {
    "numero": "R-ROTEIRO-17",
    "grupo": "ROTEIRO",
    "texto": "Se o vídeo abre pelo resultado (comum em antes e depois), o primeiro bloco do corpo volta com um marcador claro (\"tudo começou quando...\") e segue em ordem cronológica até o fim.",
    "porQue": "Começar pelo resultado chama a atenção, e voltar ao começo organiza a história.",
    "bloco": "gancho, corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (gancho com resultado exige marcador de retorno no início do corpo)",
    "fonte": "F18-3 (A, n12): embaralhar reduz o transporte; abrir pelo resultado e voltar não é embaralhar, é hipótese nossa"
  },
  {
    "numero": "R-ROTEIRO-18",
    "grupo": "ROTEIRO",
    "texto": "**Opção, não regra padrão.** Quando a ficha liga o objetivo \"que te chamem para comprar\" ou o setor aceita o caso, o corpo segue quatro passos em ordem: a situação de partida, o que atrapalhou, o que foi feito, o resultado. Quem age é uma pessoa (quem grava, ou um cliente que existe, `R-CONF-05`) com um objetivo claro. Não vale para dica, tutorial nem opinião.",
    "porQue": "Um caso contado em quatro passos mostra que você resolve o problema do cliente.",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (quatro campos preenchidos, em ordem, só quando a ficha ou o setor liga a opção)",
    "fonte": "F13-1, F11-2, F12-1 (B, n08); F18-2, F18-6 (A, n12); PO-01 (PO:387-416)"
  },
  {
    "numero": "R-ROTEIRO-19",
    "grupo": "ROTEIRO",
    "texto": "**Opção, junto do caso (`R-ROTEIRO-18`).** Diga o que se esperava e o que aconteceu, com a diferença concreta (\"achei que levaria um dia; saiu em duas horas\").",
    "porQue": "A distância entre o que se esperava e o que aconteceu é o que dá graça e prova.",
    "bloco": "corpo",
    "forca": "indicio",
    "forcaNoDocumento": "indício",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (campos \"esperado\" e \"aconteceu\" preenchidos e diferentes, só quando a opção do caso está ligada)",
    "fonte": "F10-1 (C, n07, só pista); F14-2 (C, n09); F21-4 (A, n15, vendedor: a surpresa teve 1,7 vez a taxa de visualização completa); F18-2 (A, n12)"
  },
  {
    "numero": "R-CONF-01",
    "grupo": "CONF",
    "texto": "Tudo o que o vídeo diz de preço, prazo, condição, garantia, vaga ou brinde está na ficha ou no momento e pode ser cumprido. Citando preço, diga a condição (à vista, parcelado, \"a partir de\"). Prazo e vaga limitados só se reais (data ou quantidade). O que o roteiro não tem, ele deixa em branco (\"[preencher]\") para a pessoa.",
    "porQue": "Se você falou, vale como combinado com o cliente; só diga o que pode cumprir.",
    "bloco": "corpo, chamada",
    "forca": "forte",
    "forcaNoDocumento": "forte (lei)",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (número de preço ou prazo no texto precisa existir na ficha; senão marca \"[preencher]\")",
    "fonte": "F25-1, F25-2, F25-6 (A, n18: arts. 30, 31, 37 §3º); F26-5 (A, n19: art. 27 §3º); F20-6 (A, n14)"
  },
  {
    "numero": "R-CONF-02",
    "grupo": "CONF",
    "texto": "Toda afirmação sobre fato (\"tira em 5 minutos\", \"o mais barato da região\", \"o único\", \"o melhor\") sai com o que guardar como prova, na seção \"Atenção\" (nota fiscal, foto, medição, contrato). O sistema nunca inventa número, prazo nem resultado. Afirmação que o roteiro não liga a um dado da ficha vira pergunta ao dono (\"você consegue provar isto?\"), não fala. Superlativo e comparação entram aqui.",
    "porQue": "Quem anuncia é quem tem de provar o que disse; guarde a prova antes de publicar.",
    "bloco": "corpo, \"Atenção\"",
    "forca": "forte",
    "forcaNoDocumento": "forte (lei)",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (afirmações detectadas por lista: número, \"mais\", \"melhor\", \"único\", prazo; cada uma exige item em \"Atenção\")",
    "fonte": "F25-3, F25-4, F25-7 (A, n18: arts. 36, 37, 38); F26-3, F26-4, F26-13 (A, n19: art. 27 §1º e §2º, art. 32); SA-09 (SA:1410-1416, 2297-2319)"
  },
  {
    "numero": "R-CONF-03",
    "grupo": "CONF",
    "texto": "\"Grátis\", \"gratuito\" e \"sem custo\" só aparecem se a ficha diz que não há nenhum custo ao cliente; havendo frete, taxa ou condição, o roteiro diz. \"Sem compromisso\" é permitido quando for verdade (por exemplo, orçamento que não obriga a fechar).",
    "porQue": "Só diga grátis se não custa nada; \"sem compromisso\" pode, se for verdade.",
    "bloco": "gancho, chamada",
    "forca": "forte",
    "forcaNoDocumento": "forte (CONAR)",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (lista de palavras confrontada com a ficha)",
    "fonte": "F26-6 (A, n19: art. 27 §4º); MH-08 (MH:7396-7403), sobre o tom da oferta em assunto sério"
  },
  {
    "numero": "R-CONF-04",
    "grupo": "CONF",
    "texto": "Número apresentado como pesquisa, estudo ou estatística vem com a fonte dita na fala (\"segundo o IBGE, em 2025\") e sem recorte que mude o sentido. Sem fonte identificável, o número sai ou vira \"na minha experiência\".",
    "porQue": "Número de pesquisa precisa de fonte; sem fonte é opinião sua, e tudo bem dizer assim.",
    "bloco": "corpo",
    "forca": "forte",
    "forcaNoDocumento": "forte (CONAR)",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (palavras de pesquisa e \"%\" exigem fonte do conjunto aprovado da E54 ou da ficha)",
    "fonte": "F26-9, F26-10 (A, n19: art. 27 §7º e §8º); F25-4 (A, n18); F18-5 (A, n12: o número pesa na crença)"
  },
  {
    "numero": "R-CONF-05",
    "grupo": "CONF",
    "texto": "Caso de cliente, depoimento e \"o que ele me disse\" só existem se o caso existiu e está na ficha ou no momento; o modelo nunca cria cliente, nome nem frase de cliente.",
    "porQue": "Só conte o caso de cliente se ele existiu; cliente inventado é mentira.",
    "bloco": "corpo",
    "forca": "forte",
    "forcaNoDocumento": "forte (CONAR)",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (citação de terceiro exige caso na ficha ou no momento)",
    "fonte": "F26-11 (A, n19: art. 27 §9º); F25-4 (A, n18). Reforça o PR #127 (o roteiro não inventa fato)"
  },
  {
    "numero": "R-CONF-06",
    "grupo": "CONF",
    "texto": "Se o gancho usa risco, perda ou ameaça, ela é real, plausível e proporcional, vem com o caminho de resolver e nunca explora superstição ou culpa; o medo não é o único motor do vídeo.",
    "porQue": "Pode avisar de um risco de verdade; não assuste à toa.",
    "bloco": "gancho, corpo",
    "forca": "forte",
    "forcaNoDocumento": "forte (lei)",
    "conferePorCodigo": "parcial",
    "confereNoDocumento": "parcial (lista de palavras de ameaça exige bloco de solução depois)",
    "fonte": "F25-5 (A, n18: art. 37 §2º); F26-2 (A, n19: arts. 24 e 25); F15-2 (A, n10: a ansiedade circula, contrapeso). Limita `R-COPY-22` e `R-COPY-24`"
  },
  {
    "numero": "R-CONF-07",
    "grupo": "CONF",
    "texto": "Nos ramos de saúde (dentista, médico, estética clínica, veterinário), o roteiro nunca promete cura, resultado garantido nem diagnóstico à distância; descreve o procedimento com clareza; não usa depoimento de leigo sobre tratamento; deixa em \"Atenção\" a conferência com a norma do conselho profissional. Ver a pendência do conselho de odontologia acima.",
    "porQue": "Em saúde, não prometa cura nem resultado garantido.",
    "bloco": "gancho, corpo, chamada",
    "forca": "forte",
    "forcaNoDocumento": "forte (CONAR)",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim, só nos ramos de saúde (lista: cura, garantido, 100%, sem risco, diagnóstico)",
    "fonte": "F26-14 (A, n19: Anexo G, itens 1 a 4); F25-2 (A, n18: art. 31, riscos à saúde)"
  },
  {
    "numero": "R-CONF-08",
    "grupo": "CONF",
    "texto": "Se o vídeo promove outra marca por pagamento, permuta, comissão ou presente, o roteiro inclui o aviso de publicidade, visível na tela e logo no início da legenda, de preferência com a marcação da própria rede. Vídeo do negócio sobre o próprio produto não precisa do aviso.",
    "porQue": "Se alguém te pagou ou te deu o produto, avise na tela.",
    "bloco": "frases na tela, chamada",
    "forca": "forte",
    "forcaNoDocumento": "forte (lei e CONAR) para o aviso; a forma é indício",
    "conferePorCodigo": "nao",
    "confereNoDocumento": "não (o produto não sabe se há parceria; vira pergunta no momento ou no briefing)",
    "fonte": "F26-12 (A, n19: art. 28); F25-3 (A, n18: art. 36); F27 (n19: as regras de forma do guia de influenciadores NÃO foram lidas)"
  },
  {
    "numero": "R-CONF-09",
    "grupo": "CONF",
    "texto": "O roteiro não usa palavrão nem calão; gíria só quando é a fala natural da pessoa e do público do ramo. A naturalidade da fala está em `R-FALA-10`, `R-FALA-11` e `R-FALA-12`.",
    "porQue": "Sem palavrão no roteiro; o seu jeito natural de falar continua seu.",
    "bloco": "todos",
    "forca": "forte",
    "forcaNoDocumento": "forte (CONAR)",
    "conferePorCodigo": "sim",
    "confereNoDocumento": "sim (lista)",
    "fonte": "F26-8 (A, n19: art. 27 §6º)"
  },
];
