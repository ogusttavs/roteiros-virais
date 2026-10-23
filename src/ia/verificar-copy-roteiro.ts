/**
 * E50 parte 2, PR 2: o verificador por código das regras de copy e de roteiro da seção 11 das
 * rubricas (`prompts/regras-copy-roteiro.ts`, gerado da tabela). Só confere o que a coluna
 * "Confere por código" marca "sim" (reprova) ou "só avisa" (aviso). As "parcial" ficam para
 * quando o schema tiver os campos de que dependem (decisão 575 do TODO).
 *
 * Duas fronteiras escritas na 11.0 das rubricas:
 * 1. Regra de força "indício" nunca reprova: só avisa, mesmo quando a tabela diz "sim"
 *    (R-COPY-10, R-COPY-11 e R-COPY-21 depois da decisão do Fable de 20/10/2026).
 * 2. As R-CONF passam antes de todas as outras e são as únicas que reprovam também na segunda
 *    tentativa: um roteiro que quebra a lei ou o código de autorregulação não vai para o ar.
 *    As outras reprovam só na primeira; na segunda viram aviso, para uma lista de palavras
 *    calibrada com pouco dado nunca derrubar sozinha uma geração que a pessoa está esperando
 *    (o mesmo princípio da faixa de duração do nicho, `gerarComVerificacao`).
 *
 * E59 (22/10/2026): `R-CONF-10` entra aqui (nome de partido e de candidato nunca; imagem de pessoa pública só com quem grava no quadro e sem sugerir apoio).
 *
 * Função pura, sem I/O: o serviço do roteiro monta a entrada (`EntradaCopyRoteiro`) e passa o
 * resultado para o `verificarExtra` e para os avisos de `gerarComVerificacao`.
 */

import { acharNomePolitico } from "./nomes-politicos";

export type EntradaCopyRoteiro = {
  /** Reels falado tem gancho, corpo, fechamento e chamada; Story e sem fala só têm o texto dos cartões (as regras de estrutura não valem lá). */
  estrutura: "reels_falado" | "cartoes";
  gancho: string;
  corpo: string;
  fechamento: string;
  chamadaFinal: string;
  /** Todo o texto que a pessoa fala ou lê na tela, junto: é onde as regras "de todos os blocos" olham. */
  textoTodo: string;
  /** O que entra na tela (edicao.textoNaTela), uma frase por item. */
  frasesNaTela: string[];
  /** E59: os itens do "como editar" que não são fala nem tela: cada recurso, o que fazer em cada cena e o onde gravar (`R-CONF-10` lê aqui as imagens de outro). */
  itensDaEdicao?: string[];
  /** Perfil, tema, momento, notícia, dados da pesquisa: o que vale como fonte (`montarFontesDosFatos`). */
  fontes: string;
  /** O ramo da marca é de saúde (grupo "saude" do catálogo de ramos). */
  ramoSaude: boolean;
  /** O nome da marca (R-COPY-10, só aviso). */
  nomeDaMarca?: string;
  /** O tipo de abertura declarado (R-ROTEIRO-06, só aviso). */
  tipoAbertura?: string | null;
  /** As palavras de conteúdo do tema (R-ROTEIRO-04, só aviso). */
  palavrasDoTema?: string[];
  tentativa: 1 | 2;
};

export type ResultadoCopyRoteiro = { reprovam: string[]; avisos: string[] };

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Texto em uma linha só, para as expressões não precisarem tratar quebra de linha. */
function emUmaLinha(texto: string): string {
  return texto.split(String.fromCharCode(10)).join(" ").split(String.fromCharCode(13)).join(" ");
}

function frases(texto: string): string[] {
  return emUmaLinha(texto)
    .split(/[.!?;]+(?=[ ]|$)/)
    .map((f) => f.trim())
    .filter(Boolean);
}

function palavras(texto: string): string[] {
  return emUmaLinha(texto)
    .split(/[ ]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function achar(texto: string, padrao: RegExp): string | null {
  return padrao.exec(normalizar(emUmaLinha(texto)))?.[0].trim() ?? null;
}

const COM_FRONTEIRA = (alternativas: string[]) => new RegExp(`(^|[^a-z0-9])(${alternativas.join("|")})(?![a-z0-9])`);

// --- R-CONF -----------------------------------------------------------------------------------

const GRATIS = COM_FRONTEIRA(["gratis", "gratuito", "gratuita", "gratuitos", "gratuitas", "sem custo"]);
const FONTE_DIZ_GRATIS = /gratis|gratuit|sem custo/;

/** R-CONF-03 (gancho, chamada): "grátis" e parentes só se a ficha diz que não há custo nenhum. */
function confGratis(e: EntradaCopyRoteiro): string | null {
  const alvo = `${e.gancho} ${e.chamadaFinal}`;
  const achado = achar(alvo, GRATIS);
  if (!achado) return null;
  if (FONTE_DIZ_GRATIS.test(normalizar(e.fontes))) return null;
  return `R-CONF-03: o ${e.estrutura === "reels_falado" ? "gancho ou a chamada" : "primeiro ou o último cartão"} diz "${achado.replace(/^[^a-z]+/, "")}" e a ficha não diz que não há custo nenhum; tire a palavra ou diga a condição`;
}

/** "uma pesquisa", "o estudo", "estatística": o substantivo de dado, nunca o verbo ("estudo 3 horas por dia") nem "pesquisa de preço". */
const PALAVRA_DE_PESQUISA = COM_FRONTEIRA([
  "(uma|a|as|essa|esta|nova|novas|outra) pesquisas?(?! de preco)",
  "pesquisas? (mostra|mostram|diz|dizem|aponta|apontam|revela|revelam|feita|realizada)",
  "(um|o|os|esse|este|novo|novos|outro) estudos?",
  "estudos (mostra|mostram|diz|dizem|aponta|apontam|revela|revelam)",
  "estatisticas?",
  "levantamentos?",
]);
/** Percentual sem fonte reprova, exceto o da oferta ("100% natural", "50% de desconto"). */
const PERCENTUAL_DA_OFERTA = /(de desconto|off|de juros|a vista|de entrada|de comissao|de lucro|natural|algodao|puro|pura)/;
const PERCENTUAL = /[0-9]+([.,][0-9]+)?[ ]?(%|por cento)/;
const NUMERO_NA_FRASE = /[0-9]/;
const ATRIBUICAO = /(^|[^a-z0-9])(segundo (o|a|os|as|um|uma|dados|pesquisa|estudo)|de acordo com|conforme|divulgad|publicad|realizad|feita pel|feito pel|minha experiencia|na minha pratica|o que eu vejo)/;

/**
 * R-CONF-04 (corpo): número apresentado como pesquisa, estudo ou estatística vem com a fonte dita na
 * fala; sem fonte, o número sai ou vira "na minha experiência". Confere por frase: a frase tem
 * palavra de pesquisa ou "%" e não traz atribuição nem tem o "%" escrito nas fontes da entrada.
 */
function confPesquisaSemFonte(e: EntradaCopyRoteiro): string | null {
  const fontes = normalizar(emUmaLinha(e.fontes));
  for (const frase of frases(e.corpo)) {
    const n = normalizar(frase);
    const percentual = PERCENTUAL.exec(n)?.[0];
    const pesquisa = PALAVRA_DE_PESQUISA.test(n);
    const percentualDeDado = Boolean(percentual) && !PERCENTUAL_DA_OFERTA.test(n);
    if (!percentualDeDado && !(pesquisa && NUMERO_NA_FRASE.test(n))) continue;
    if (ATRIBUICAO.test(n)) continue;
    const comoNasFontes = (percentual ?? "").split("por cento").join("%").split(" ").join("");
    if (percentual && fontes.split(" ").join("").includes(comoNasFontes)) continue;
    return `R-CONF-04: o corpo apresenta ${percentual ? `"${percentual}"` : "um dado de pesquisa"} sem dizer a fonte na fala ("segundo ..., em ...") e sem que esteja na ficha; diga a fonte ou troque por "na minha experiência"`;
  }
  return null;
}

/** A promessa, não a palavra solta: "tem cura?", "faço o diagnóstico na avaliação" e "o diagnóstico precoce" são conversa honesta de clínica. */
const PALAVRAS_DE_SAUDE = COM_FRONTEIRA([
  "garantid[oa]s?",
  "garantimos",
  "garanto",
  "cura (garantida|definitiva|total|certa|rapida|imediata)",
  "(garantimos|prometo|prometemos) a cura",
  "(vou|vamos|posso|podemos|conseguimos|consigo) curar",
  "curamos",
  "te curo",
  "100% (seguro|segura|garantid[oa]|eficaz|sem dor|certo|de sucesso|de resultado)",
  "sem riscos?",
  "diagnostico (a distancia|online|por (whatsapp|zap|direct|mensagem|video|foto|chat)|pelo (whatsapp|zap|direct|celular|video|chat)|pela (foto|internet))",
]);

/** R-CONF-07 (gancho, corpo, chamada), só nos ramos de saúde. */
function confSaude(e: EntradaCopyRoteiro): string | null {
  if (!e.ramoSaude) return null;
  const achado = achar(`${e.gancho} ${e.corpo} ${e.chamadaFinal}`, PALAVRAS_DE_SAUDE);
  if (!achado) return null;
  return `R-CONF-07: em ramo de saúde o roteiro não promete cura, resultado garantido nem diagnóstico à distância; tire "${achado.replace(/^[^a-z0-9]+/, "")}"`;
}

const CALAO = COM_FRONTEIRA([
  "porra",
  "caralho",
  "merda",
  "bosta",
  "foda",
  "foda-se",
  "fodase",
  "fodido",
  "fodida",
  "foder",
  "puta",
  "pqp",
  "buceta",
  "cacete",
  "cuzao",
  "arrombado",
  "desgraca",
]);

/** R-CONF-09 (todos): nada de palavrão nem calão. */
function confCalao(e: EntradaCopyRoteiro): string | null {
  const achado = achar(e.textoTodo, CALAO);
  return achado ? `R-CONF-09: o roteiro tem palavrão ou calão ("${achado.replace(/^[^a-z]+/, "")}"); tire` : null;
}

// --- R-CONF-10 (E59) --------------------------------------------------------------------------

/** R-CONF-10 (todos os blocos e o "como editar"): nome de partido ou de candidato nunca sai, fale pelo papel. */
function confPartidoOuCandidato(e: EntradaCopyRoteiro): string | null {
  const achado = acharNomePolitico([e.textoTodo, ...(e.itensDaEdicao ?? [])].join(". "));
  if (!achado) return null;
  return `R-CONF-10: o roteiro cita ${achado.tipo === "partido" ? "o partido" : "o candidato"} "${achado.trecho}"; tire o nome e fale pelo papel ("o candidato mais votado", "uma figura de cada lado")`;
}

/** Foto, print, tela dividida ou trecho de vídeo (imagem de outra pessoa na tela). */
const IMAGEM_DE_OUTRO = /(tela dividida|split screen|divid[ao] (ao meio|em duas)|(^|[^a-z])fotos?([^a-z]|$)|fotografias?|(^|[^a-z])prints?([^a-z]|$)|captura de tela|imagens? d[aeo]s?|imagens de|trechos? (curtos? )?(de|do|da) (video|videos|entrevista|fala|discurso|reportagem)|recortes? d[aeo]s? (video|foto|imagem|entrevista|reportagem))/;
/** Pessoa pública: pelo papel (a sugestão é aberta) ou pelo cargo. */
const PESSOA_PUBLICA = /(^|[^a-z])((figuras?|pessoas?|personalidades?) ((muito|bem|super|mais|tao|extremamente) )*(publicas?|famosas?|conhecidas?|eleitorais|politicas?)|famos[oa]s?|celebridades?|politic[oa]s?|deputad[oa]s?|senador(a|es)?|candidat[oa]s?|governador(a|es)?|prefeit[oa]s?|presidente|autoridades?|personalidades?|influenciador(a|es)?|artistas?|cantor(a|es)?|jogador(a|es)?|atores|atriz(es)?)([^a-z]|$)/;
/** A pessoa que grava aparece no quadro, comentando. */
const NO_QUADRO = /(no quadro|em quadro|em cena|tela cheia|(voce|quem grava|a pessoa|o dono|a dona)[^.;]{0,50}(aparec|continu|segu|fic[ae]|permanec|comenta|falando|fala)|(aparec|continu|segu|permanec)[^.;]{0,25}(falando|comentando|no video|no quadro|em cena))/;
const APOIO = /(apoia|apoiando|apoio|recomenda|recomendando|aprova|aprovando|endossa|endossando|ao lado do (produto|nosso produto|logo|negocio)|segurando o (produto|nosso produto)|com o (produto|logo) d[eao]s?)/;
const NEGACAO_ANTES = /(nunca|jamais|sem|nao|evite|evitar|nada de)[^.;]{0,40}$/;

function itensComImagemDePessoaPublica(e: EntradaCopyRoteiro): string[] {
  return (e.itensDaEdicao ?? []).filter((item) => {
    const n = normalizar(emUmaLinha(item));
    return IMAGEM_DE_OUTRO.test(n) && PESSOA_PUBLICA.test(n);
  });
}

/** R-CONF-10: a sugestão de imagem de pessoa pública sempre diz que quem grava continua no quadro, comentando. */
function confImagemSemQuadro(e: EntradaCopyRoteiro): string | null {
  const itens = itensComImagemDePessoaPublica(e);
  if (itens.length === 0) return null;
  const tudo = normalizar(emUmaLinha((e.itensDaEdicao ?? []).join(". ")));
  if (NO_QUADRO.test(tudo)) return null;
  return `R-CONF-10: o "como editar" sugere imagem de pessoa pública ("${itens[0].slice(0, 80)}") e não diz que você continua no quadro, comentando; acrescente isso (a imagem é só a prova do que você diz)`;
}

/** R-CONF-10: a imagem de pessoa pública nunca é montada para sugerir que ela apoia o negócio ou o produto. */
function confImagemComApoio(e: EntradaCopyRoteiro): string | null {
  for (const item of itensComImagemDePessoaPublica(e)) {
    const n = normalizar(emUmaLinha(item));
    const achado = APOIO.exec(n);
    if (!achado) continue;
    if (NEGACAO_ANTES.test(n.slice(0, achado.index))) continue;
    return `R-CONF-10: a imagem de pessoa pública não pode sugerir que ela apoia, recomenda ou aprova o negócio ("${achado[0]}"); tire essa montagem`;
  }
  return null;
}

// --- R-COPY e R-ROTEIRO (reprovam só na primeira tentativa) -----------------------------------

const VOCATIVO_COLETIVO = /(^|[.!?][ ]+)(pessoal|galera|turma|gente|meninas|meninos|amigos|amigas|seguidores)[ ]*[,!]/;
// O vocativo só vale no começo da frase: "a gente, aqui na loja," e "muita gente, quando" não são vocativos.
const SAUDACAO_COM_COLETIVO = /\b(oi|ola|ei|fala|e ai|bom dia|boa tarde|boa noite)[ ,]+(pessoal|galera|turma|gente|meninas|meninos|amigos|amigas|seguidores)\b/;

/** R-COPY-01 (todos): "você" no singular, nunca "pessoal", "galera", "turma". */
function copyVocativo(e: EntradaCopyRoteiro): string | null {
  const n = normalizar(emUmaLinha(e.textoTodo));
  const m = VOCATIVO_COLETIVO.exec(n) ?? SAUDACAO_COM_COLETIVO.exec(n);
  if (!m) return null;
  const palavra = /pessoal|galera|turma|gente|meninas|meninos|amigos|amigas|seguidores/.exec(m[0])?.[0] ?? "";
  return `R-COPY-01: o roteiro fala com um grupo ("${palavra}"); fale com uma pessoa só, com "você"`;
}

const PROPAGANDA = COM_FRONTEIRA([
  "imperdivel",
  "imperdiveis",
  "incrivel",
  "incriveis",
  "revolucionari[oa]s?",
  "inovador[a]?s?",
  "imbativel",
  "imbativeis",
  "sensacional",
  "espetacular",
  "oportunidade unica",
  "nao perca(?! tempo)",
  "alta qualidade",
  "qualidade superior",
  "qualidade incomparavel",
  "lider de mercado",
  "excelencia",
  "de primeira linha",
]);
const ADJETIVO_VAGO = COM_FRONTEIRA([
  "incrivel",
  "maravilhos[oa]s?",
  "perfeit[oa]s?",
  "lind[oa]s?",
  "otim[oa]s?",
  "excelentes?",
  "fantastic[oa]s?",
  "top",
  "sensacional",
  "especial",
  "unic[oa]s?",
  "premium",
]);

/** R-COPY-02 (todos): palavras de conversa; lista de propaganda e adjetivo empilhado (três ou mais vagos numa frase). */
function copyPropaganda(e: EntradaCopyRoteiro): string | null {
  const achado = achar(e.textoTodo, PROPAGANDA);
  if (achado) return `R-COPY-02: tom de propaganda ("${achado.replace(/^[^a-z]+/, "")}"); use palavras de conversa do cliente do ramo`;
  for (const frase of frases(e.textoTodo)) {
    const n = normalizar(frase);
    let vagos = 0;
    for (const w of palavras(n)) if (ADJETIVO_VAGO.test(w.replace(/[^a-z]/g, ""))) vagos++;
    if (vagos >= 3) return `R-COPY-02: adjetivos empilhados numa frase ("${frase.trim().slice(0, 60)}"); fique com um e dê o fato`;
  }
  return null;
}

const SUPERLATIVO = COM_FRONTEIRA([
  "(o|a|os|as) melhor(es)? (do|da|dos|das|de) (mercado|regiao|brasil|cidade|mundo|bairro|ramo|setor)",
  "(o|a|os|as) melhor(es)? (preco|custo|marca|qualidade|produto|servico|atendimento)",
  "(o|a) mais (barato|barata|em conta)",
  "(o|a) maior (do|da|de)",
  "numero (1|um) (do|da|de|no|na) (brasil|mercado|regiao|cidade|bairro|ramo)",
  "lider (do|da|de) (mercado|regiao|setor|segmento|cidade)",
  "melhor (que|do que) (os |as )?(outros|outras|concorrentes)",
]);
const NUMERO_POR_EXTENSO = COM_FRONTEIRA(["dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "vinte", "trinta", "cem", "mil"]);

/** Tem número (algarismo) ou nome próprio (palavra com inicial maiúscula fora do começo da frase) no texto. */
function temNumeroOuNomeProprio(texto: string): boolean {
  if (/[0-9]/.test(texto)) return true;
  for (const frase of frases(texto)) {
    const p = palavras(frase);
    for (let i = 1; i < p.length; i++) {
      if (/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç]{2,}/.test(p[i])) return true;
    }
  }
  return false;
}

/** R-COPY-08 (gancho, corpo): sem superlativo de lista; pelo menos um número ou nome próprio no gancho ou no corpo. */
function copyFatoEspecifico(e: EntradaCopyRoteiro): string | null {
  const achado = achar(`${e.gancho} ${e.corpo}`, SUPERLATIVO);
  if (achado) return `R-COPY-08: superlativo ("${achado.replace(/^[^a-z0-9]+/, "")}") no lugar de fato específico; troque por número, prazo, quantidade ou nome`;
  // Só no Reels falado: o texto na tela do Story e do sem fala é curto demais (até 8 palavras por vez) para exigir número ou nome em toda cena.
  if (e.estrutura !== "reels_falado") return null;
  const base = `${e.gancho} ${e.corpo}`;
  if (!temNumeroOuNomeProprio(base) && !NUMERO_POR_EXTENSO.test(normalizar(emUmaLinha(base)))) {
    return "R-COPY-08: nem o gancho nem o corpo trazem um número ou um nome próprio; ponha um fato específico (número, prazo, quantidade ou nome) que esteja na ficha ou no momento";
  }
  return null;
}

const ATAQUE_OU_AUTOELOGIO = COM_FRONTEIRA([
  "somos (os|as) melhores",
  "somos o melhor",
  "somos a melhor",
  "sou o melhor",
  "sou a melhor",
  "ninguem faz (como|melhor)",
  "ninguem e melhor",
  "sem concorrencia",
  "concorrentes? (e|sao) (ruins?|lixo|picaretas?|enganador(es)?)",
  "picaretas?",
  "enganam (o |os )?(cliente|clientes)",
  "cliente (burro|chato|idiota)",
  "clientes (burros|chatos|idiotas)",
  "melhor (que|do que) (os |as )?(outros|outras|concorrentes)",
]);

/** R-COPY-23 (todos): sem se gabar, sem atacar concorrente nem cliente. */
function copyAtaque(e: EntradaCopyRoteiro): string | null {
  const achado = achar(e.textoTodo, ATAQUE_OU_AUTOELOGIO);
  return achado ? `R-COPY-23: autoelogio ou ataque ("${achado.replace(/^[^a-z]+/, "")}"); mostre o trabalho em vez de se gabar, sem falar mal de concorrente nem de cliente` : null;
}

const CANAIS: { nome: string; padrao: RegExp }[] = [
  { nome: "WhatsApp", padrao: COM_FRONTEIRA(["whatsapp", "whats", "zap"]) },
  { nome: "Direct", padrao: COM_FRONTEIRA(["direct", "dm", "mensagem privada", "inbox"]) },
  { nome: "ligação", padrao: COM_FRONTEIRA(["ligue", "ligacao", "telefone"]) },
  { nome: "comentário", padrao: COM_FRONTEIRA(["comente", "comenta", "nos comentarios"]) },
  { nome: "link da bio", padrao: COM_FRONTEIRA(["link na bio", "link da bio", "na bio"]) },
  { nome: "visita", padrao: COM_FRONTEIRA(["venha", "visite", "passa aqui", "passe aqui"]) },
  { nome: "site", padrao: COM_FRONTEIRA(["site", "acesse"]) },
  { nome: "seguir", padrao: COM_FRONTEIRA(["siga", "me segue", "segue a gente", "segue o perfil"]) },
];
const SO_COMPRAR = COM_FRONTEIRA(["compre", "compra", "comprar", "adquira", "adquirir"]);
const OUTRO_VERBO_DE_ACAO = COM_FRONTEIRA([
  "chame",
  "chama",
  "manda",
  "mande",
  "ligue",
  "comente",
  "comenta",
  "siga",
  "segue",
  "salve",
  "salva",
  "compartilhe",
  "compartilha",
  "marque",
  "marca",
  "venha",
  "vem",
  "agende",
  "agenda",
  "visite",
  "clique",
  "acesse",
  "peca",
  "pede",
  "baixe",
  "responda",
  "responde",
  "vote",
  "vota",
  "conte",
  "conta",
  "escreva",
  "escreve",
  "fale",
  "fala",
  "experimente",
  "teste",
  "testa",
  "reserve",
  "confira",
  "veja",
  "pergunte",
  "pergunta",
  "faca",
  "garanta",
  "aproveite",
  "entre",
  "cadastre",
  "chamar",
  "link na bio",
]);

/** R-COPY-25 (chamada): uma só ação, um canal, e "compre" não é o único verbo. */
function copyChamada(e: EntradaCopyRoteiro): string | null {
  if (e.estrutura !== "reels_falado" || !e.chamadaFinal.trim()) return null;
  const n = normalizar(emUmaLinha(e.chamadaFinal));
  let canais = CANAIS.filter((c) => c.padrao.test(n)).map((c) => c.nome);
  // "Comente QUERO que eu te mando no Direct" é uma ação só: o comentário é o gatilho do mesmo canal.
  if (canais.includes("comentário") && (canais.includes("Direct") || canais.includes("WhatsApp"))) canais = canais.filter((c) => c !== "comentário");
  if (canais.length >= 2) {
    return `R-COPY-25: a chamada pede mais de um caminho (${canais.join(" e ")}); escolha uma só ação, a mais fácil, num canal só`;
  }
  if (SO_COMPRAR.test(n) && !OUTRO_VERBO_DE_ACAO.test(n)) {
    return 'R-COPY-25: a chamada só manda comprar; ofereça antes um passo mais fácil (chamar, perguntar, pedir um orçamento, passar na loja)';
  }
  return null;
}

/** R-ROTEIRO-01 (todos, só Reels falado): gancho, corpo e fechamento preenchidos. */
function roteiroPreenchido(e: EntradaCopyRoteiro): string | null {
  if (e.estrutura !== "reels_falado") return null;
  const faltam = [
    ["gancho", e.gancho],
    ["corpo", e.corpo],
    ["fechamento", e.fechamento],
  ]
    .filter(([, t]) => !t.trim())
    .map(([nome]) => nome);
  return faltam.length > 0 ? `R-ROTEIRO-01: o roteiro não tem ${faltam.join(", ")}; o vídeo precisa de começo, meio e fim` : null;
}

const ENCERRAMENTO_VAZIO = /^(entao e isso|e isso( ai)?|obrigad[oa]( por assistir| por ver)?|valeu|tchau|ate a proxima|ate logo|por hoje e so|fico por aqui)[ ]*($|[,.!?;:])/;

/** R-ROTEIRO-14 (fechamento, chamada, só Reels falado): o último bloco não começa com encerramento vazio e traz ação ou pergunta. */
function roteiroUltimoBloco(e: EntradaCopyRoteiro): string | null {
  if (e.estrutura !== "reels_falado") return null;
  const ultimo = e.chamadaFinal.trim() || e.fechamento.trim();
  if (!ultimo) return null; // o R-ROTEIRO-01 já cobre o que falta
  const n = normalizar(emUmaLinha(ultimo)).replace(/^[^a-z0-9]+/, "");
  if (ENCERRAMENTO_VAZIO.test(n)) return 'R-ROTEIRO-14: o último bloco abre com um encerramento vazio ("então é isso", "obrigado por assistir"); termine com um pedido claro';
  if (!OUTRO_VERBO_DE_ACAO.test(n) && !n.includes("?")) return "R-ROTEIRO-14: o último bloco não traz uma ação clara nem uma pergunta ao espectador; termine com um pedido";
  return null;
}

/** Teto de palavras do fechamento (R-ROTEIRO-15: uma ou duas frases, "teto a calibrar"; 45 vem de duas frases de 20 mais folga). */
export const TETO_PALAVRAS_FECHAMENTO = 45;

/** R-ROTEIRO-15 (fechamento, só Reels falado): curto e afirmativo, uma ou duas frases. */
function roteiroFechamentoCurto(e: EntradaCopyRoteiro): string | null {
  if (e.estrutura !== "reels_falado") return null;
  const total = palavras(e.fechamento).length;
  const nFrases = frases(e.fechamento).length;
  if (total > TETO_PALAVRAS_FECHAMENTO || nFrases > 2) {
    return `R-ROTEIRO-15: o fechamento tem ${total} palavras em ${nFrases} frases; deixe em uma ou duas frases curtas, sem recapitular tudo`;
  }
  return null;
}

// --- Só avisam ---------------------------------------------------------------------------------

const MAX_PALAVRAS_POR_FRASE = 20;
const GENERICA = COM_FRONTEIRA(["milhoes de", "estudos mostram", "estudos comprovam", "todo mundo faz", "a maioria", "todo mundo sabe", "comprovado cientificamente"]);

function avisosSomente(e: EntradaCopyRoteiro): string[] {
  const avisos: string[] = [];

  // R-COPY-03 (corpo, frases na tela): frases faladas de 15 a 20 palavras no máximo.
  const longa = [...frases(e.corpo), ...e.frasesNaTela].find((f) => palavras(f).length > MAX_PALAVRAS_POR_FRASE);
  if (longa) avisos.push(`R-COPY-03: tem frase com mais de ${MAX_PALAVRAS_POR_FRASE} palavras ("${longa.trim().slice(0, 50)}...")`);

  // R-COPY-10 (indício): o nome da marca aparece pelo menos uma vez.
  if (e.nomeDaMarca && e.nomeDaMarca.trim().length > 2 && !normalizar(emUmaLinha(e.textoTodo)).includes(normalizar(e.nomeDaMarca.trim()))) {
    avisos.push("R-COPY-10: o nome da marca não aparece na fala nem na tela");
  }

  // R-COPY-21 (indício, depois da decisão de 20/10/2026): prova genérica sem número e fonte.
  if (e.estrutura === "reels_falado" || e.corpo) {
    const generica = achar(`${e.corpo} ${e.chamadaFinal}`, GENERICA);
    if (generica && !normalizar(e.fontes).includes(generica.replace(/^[^a-z]+/, ""))) {
      avisos.push(`R-COPY-21: prova genérica ("${generica.replace(/^[^a-z]+/, "")}") sem número e fonte`);
    }
  }

  if (e.estrutura === "reels_falado") {
    // R-ROTEIRO-04: o assunto cedo e a primeira frase até 12 palavras.
    const primeira = frases(e.gancho)[0] ?? "";
    if (palavras(primeira).length > 12) avisos.push(`R-ROTEIRO-04: a primeira frase tem ${palavras(primeira).length} palavras (a referência é até 12)`);
    const inicio = normalizar(palavras(e.gancho).slice(0, 15).join(" "));
    const termos = (e.palavrasDoTema ?? []).map(normalizar).filter(Boolean);
    if (termos.length > 0 && !termos.some((t) => inicio.includes(t))) avisos.push("R-ROTEIRO-04: o assunto do tema não aparece nas primeiras 15 palavras do gancho");

    // R-ROTEIRO-06: o tipo de abertura registrado.
    if (!e.tipoAbertura) avisos.push("R-ROTEIRO-06: o tipo de abertura não foi registrado");

    // R-ROTEIRO-16: um quarto, metade, um quarto (hipótese; só com texto suficiente para medir).
    const a = palavras(e.gancho).length;
    const c = palavras(e.corpo).length;
    const r = palavras(`${e.fechamento} ${e.chamadaFinal}`).length;
    const total = a + c + r;
    if (total >= 60 && (a / total > 0.4 || r / total > 0.4 || c / total < 0.35)) {
      avisos.push(`R-ROTEIRO-16: o peso dos blocos foge de um quarto, metade e um quarto (abertura ${a}, desenvolvimento ${c}, fim ${r} palavras)`);
    }
  }
  return avisos;
}

// --- Entrada -----------------------------------------------------------------------------------

type Conferencia = { regra: string; roda: (e: EntradaCopyRoteiro) => string | null };

/** As R-CONF, na ordem do documento: passam antes de todas as outras e reprovam nas duas tentativas. */
const CONFORMIDADE: Conferencia[] = [
  { regra: "R-CONF-03", roda: confGratis },
  { regra: "R-CONF-04", roda: confPesquisaSemFonte },
  { regra: "R-CONF-07", roda: confSaude },
  { regra: "R-CONF-09", roda: confCalao },
  { regra: "R-CONF-10", roda: confPartidoOuCandidato },
  { regra: "R-CONF-10", roda: confImagemSemQuadro },
  { regra: "R-CONF-10", roda: confImagemComApoio },
];

/** As "sim" de força forte ou média: reprovam na primeira tentativa e viram aviso na segunda. */
const DEMAIS: Conferencia[] = [
  { regra: "R-COPY-01", roda: copyVocativo },
  { regra: "R-COPY-02", roda: copyPropaganda },
  { regra: "R-COPY-08", roda: copyFatoEspecifico },
  { regra: "R-COPY-23", roda: copyAtaque },
  { regra: "R-COPY-25", roda: copyChamada },
  { regra: "R-ROTEIRO-01", roda: roteiroPreenchido },
  { regra: "R-ROTEIRO-14", roda: roteiroUltimoBloco },
  { regra: "R-ROTEIRO-15", roda: roteiroFechamentoCurto },
];

export const REGRAS_QUE_REPROVAM = [...new Set([...CONFORMIDADE, ...DEMAIS].map((c) => c.regra))];

/** O que a saída do roteiro longo precisa ter para a conformidade (R-CONF) olhar: o gancho do vídeo, cada capítulo (nome, pontos, gancho para o próximo, na imagem), a chamada e a tela. */
export type SaidaLongaParaConformidade = {
  gancho: string;
  chamadaFinal: string;
  capitulos: { nome: string; pontos: string[]; ganchoParaOProximo: string | null; naImagem: string }[];
  edicao: { textoNaTela: { oQue: string }[]; recursos?: string[] };
  ondeGravar?: string;
};

/**
 * E50 parte 2, PR 4: as R-CONF no roteiro longo (decisão do Fable de 20/10/2026: a conformidade vale
 * em qualquer roteiro). Só elas, e reprovam nas duas tentativas. O corpo é a fala dos capítulos
 * (pontos e gancho para o próximo); as regras de estrutura e de texto do vídeo curto não rodam aqui.
 */
export function verificarConformidadeDoLongo(saida: SaidaLongaParaConformidade, contexto: { fontes: string; ramoSaude: boolean }): string[] {
  const frasesNaTela = saida.edicao.textoNaTela.map((t) => t.oQue).filter((t) => t.trim());
  const corpo = saida.capitulos.flatMap((c) => [...c.pontos, c.ganchoParaOProximo ?? ""]).filter((t) => t.trim()).join(". ");
  const nomes = saida.capitulos.map((c) => c.nome).join(". ");
  const entrada: EntradaCopyRoteiro = {
    estrutura: "reels_falado",
    gancho: saida.gancho,
    corpo,
    fechamento: "",
    chamadaFinal: saida.chamadaFinal,
    textoTodo: [saida.gancho, nomes, corpo, saida.chamadaFinal, ...frasesNaTela].join(". "),
    frasesNaTela,
    itensDaEdicao: [...(saida.edicao.recursos ?? []), saida.ondeGravar ?? ""].filter((t) => t.trim()),
    fontes: contexto.fontes,
    ramoSaude: contexto.ramoSaude,
    tentativa: 1,
  };
  return CONFORMIDADE.map((c) => c.roda(entrada)).filter((m): m is string => Boolean(m));
}

export function verificarRegrasCopyRoteiro(entrada: EntradaCopyRoteiro): ResultadoCopyRoteiro {
  const reprovam: string[] = [];
  const avisos: string[] = [];
  for (const c of CONFORMIDADE) {
    const motivo = c.roda(entrada);
    if (!motivo) continue;
    // Conformidade não afrouxa (11.0): roteiro que inventa dado não vai para o ar, nas duas tentativas.
    reprovam.push(motivo);
  }
  for (const c of DEMAIS) {
    const motivo = c.roda(entrada);
    if (!motivo) continue;
    (entrada.tentativa === 1 ? reprovam : avisos).push(motivo);
  }
  avisos.push(...avisosSomente(entrada));
  return { reprovam, avisos };
}

/** O que a saída do roteiro precisa ter para virar `EntradaCopyRoteiro` (o schema do prompt tem de sobra). */
export type SaidaParaCopyRoteiro = {
  gancho: string | null;
  corpo: string | null;
  fechamento: string | null;
  chamadaFinal: string | null;
  cartoes: { oQueFalar: string; textoNaTela: string }[] | null;
  edicao: { textoNaTela: { oQue: string }[]; recursos?: string[] };
  /** E59: o que fazer em cada cena e o onde gravar entram em `itensDaEdicao` (`R-CONF-10`). */
  cenas?: { oQueFazer: string }[];
  ondeGravar?: string;
  tipoAbertura: string | null;
};

/**
 * Monta a entrada a partir da saída do roteiro. Reels falado usa os quatro blocos; Story e sem fala
 * (que têm `cartoes`) entram com o primeiro cartão como gancho, os do meio como corpo e o último
 * como chamada, e as regras de estrutura (R-ROTEIRO-01, 14, 15 e R-COPY-25) não rodam neles.
 */
export function montarEntradaCopyRoteiro(
  saida: SaidaParaCopyRoteiro,
  contexto: Pick<EntradaCopyRoteiro, "fontes" | "ramoSaude" | "nomeDaMarca" | "palavrasDoTema" | "tentativa">,
): EntradaCopyRoteiro {
  const frasesNaTela = saida.edicao.textoNaTela.map((t) => t.oQue).filter((t) => t.trim());
  const itensDaEdicao = [...(saida.edicao.recursos ?? []), ...(saida.cenas ?? []).map((c) => c.oQueFazer), saida.ondeGravar ?? ""].filter((t) => t.trim());
  if (saida.cartoes && saida.cartoes.length > 0) {
    const textos = saida.cartoes.map((c) => `${c.oQueFalar} ${c.textoNaTela}`.trim());
    const ultimo = textos.length > 1 ? textos[textos.length - 1] : "";
    return {
      ...contexto,
      estrutura: "cartoes",
      gancho: textos[0],
      corpo: textos.slice(1, textos.length > 1 ? -1 : undefined).join(". "),
      fechamento: "",
      chamadaFinal: ultimo,
      textoTodo: [...textos, ...frasesNaTela].join(". "),
      frasesNaTela,
      itensDaEdicao,
      tipoAbertura: saida.tipoAbertura,
    };
  }
  const gancho = saida.gancho ?? "";
  const corpo = saida.corpo ?? "";
  const fechamento = saida.fechamento ?? "";
  const chamadaFinal = saida.chamadaFinal ?? "";
  return {
    ...contexto,
    estrutura: "reels_falado",
    gancho,
    corpo,
    fechamento,
    chamadaFinal,
    textoTodo: [gancho, corpo, fechamento, chamadaFinal, ...frasesNaTela].join(". "),
    frasesNaTela,
    itensDaEdicao,
    tipoAbertura: saida.tipoAbertura,
  };
}
