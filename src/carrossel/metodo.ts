/**
 * E65 PR 3: o carrossel cumpre o que a capa promete. Regras por código, sem mexer no prompt (o motivo da reprova vira a instrução da segunda tentativa, que o fluxo de `gerarComVerificacao` já faz), a partir da seção 3
 * de `pesquisa/carrossel-contra-o-metodo-do-kit.md`: (1) o número que a capa promete bate com os itens ou passos; (3) a capa não usa molde vago (lista fechada, escrita por nós) e, sem número, pergunta nem verbo de
 * ação, só gera aviso; (5) a legenda não repete o título da capa; (6) item e passo muito curtos geram aviso. Funções puras, sem banco nem IA. As reprovas voltam como motivos; os avisos são frases para a pessoa
 * (guardadas no carrossel e mostradas na tela, nunca travam). A lista de fórmulas com cara de máquina (item 2) é a do roteiro (`ia/formulas-de-maquina.ts`), chamada por `formulasDeMaquinaDosSlides` em `regras.ts`.
 */
import { ehCapa, type SlideDoCarrossel } from "@/config/carrossel";
import { textosCarrossel } from "@/textos/carrossel";

const semAcento = (t: string): string => Array.from(t, (c) => c.normalize("NFD")[0].toLowerCase()).join("");

const EXTENSO: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, quinze: 15, vinte: 20 };

/** As coisas que uma capa conta em lista ("3 erros", "cinco passos"). Só estas valem como promessa de quantidade: "45 graus" ou "2 minutos" não são itens. */
const COISAS_QUE_SE_CONTAM = [
  "erros", "dicas", "passos", "sinais", "motivos", "causas", "jeitos", "formas", "maneiras", "coisas", "segredos", "cuidados", "mitos", "truques", "ideias", "habitos", "razoes", "sintomas", "regras",
  "perguntas", "exemplos", "etapas", "licoes", "beneficios", "vantagens", "opcoes", "ingredientes", "produtos", "tipos", "receitas", "curiosidades", "verdades", "hacks", "alertas", "atitudes",
];

const PROMESSA = new RegExp(`(?:^|[^a-z0-9])(\\d{1,2}|${Object.keys(EXTENSO).join("|")})\\s+(?:[a-z]+\\s+)?(${COISAS_QUE_SE_CONTAM.join("|")})(?![a-z])`);

/** O número e a coisa que a capa promete ("3 erros" vira { quantidade: 3, coisa: "erros" }), ou nulo se a capa não promete uma contagem. */
export function promessaDeContagem(textoDaCapa: string): { quantidade: number; coisa: string } | null {
  const m = PROMESSA.exec(semAcento(textoDaCapa));
  if (!m) return null;
  const quantidade = /^\d/.test(m[1]) ? Number(m[1]) : EXTENSO[m[1]];
  // "Uma das causas" e "Um dos sinais" não prometem lista de um: só conta quando a capa promete 2 ou mais.
  return quantidade >= 2 ? { quantidade, coisa: m[2] } : null;
}

/** As coisas que a capa conta e que são itens (causa, erro, sinal) ou passos (passo, etapa, jeito): decide qual contagem vale quando o carrossel tem os dois tipos. */
const PALAVRAS_DE_ITEM = new Set(["erros", "causas", "sinais", "mitos", "motivos", "coisas", "sintomas", "razoes", "alertas", "verdades"]);
const PALAVRAS_DE_PASSO = new Set(["passos", "etapas", "jeitos"]);

/** Os slides que contam como "a lista" da capa: os itens e os passos. */
const contaComoLista = (s: SlideDoCarrossel): boolean => s.tipo === "item" || s.tipo === "passo";

/**
 * A promessa da capa é cumprida: se o título (ou a linha de apoio) diz "3 erros", o carrossel traz 3 itens ou passos. Também vale a contagem de todos os slides de conteúdo (entre a capa e a chamada, sem o
 * resumo), para um carrossel que mistura item com dado ou antes e depois não ser reprovado à toa. Divergiu, devolve o motivo (que a segunda tentativa recebe).
 */
export function verificarPromessaDaCapa(slides: SlideDoCarrossel[]): string[] {
  const capa = slides[0];
  if (!capa || !ehCapa(capa.tipo)) return [];
  const promessa = promessaDeContagem(`${capa.titulo}. ${capa.sub ?? ""}`);
  if (!promessa) return [];
  const itens = slides.filter((s) => s.tipo === "item").length;
  const passos = slides.filter((s) => s.tipo === "passo").length;
  const conteudo = slides.slice(1, -1).filter((s) => s.tipo !== "resumo").length;
  // Com item e passo juntos, a promessa conta só a coisa de que a capa fala: "2 causas" são os itens, "3 passos" são os passos. Na dúvida (dicas, formas), qualquer uma das duas contagens vale.
  const quantos = itens > 0 && passos > 0 ? (PALAVRAS_DE_ITEM.has(promessa.coisa) ? itens : PALAVRAS_DE_PASSO.has(promessa.coisa) ? passos : null) : itens + passos;
  const bate = quantos === null ? promessa.quantidade === itens || promessa.quantidade === passos : promessa.quantidade === quantos;
  if (bate || promessa.quantidade === conteudo) return [];
  const misturado = itens > 0 && passos > 0;
  const traz = quantos === null ? `${itens} itens e ${passos} passos` : misturado ? `${quantos} ${PALAVRAS_DE_ITEM.has(promessa.coisa) ? (quantos === 1 ? "item" : "itens") : quantos === 1 ? "passo" : "passos"}` : `${quantos} (itens e passos)`;
  return [
    `slide 1: a capa promete ${promessa.quantidade} ${promessa.coisa} e o carrossel traz ${traz}; faça o número da capa e a quantidade de itens ou passos serem a mesma coisa, e nunca prometa mais do que entrega`,
  ];
}

/**
 * Os moldes que prometem sem dizer nada, banidos no título da capa (lista fechada, escrita por nós): tudo sobre o assunto, guia definitivo, revelação sem dizer qual, anúncio de uma era. Cada molde tem o nome
 * que a reprova mostra.
 */
const MOLDES_VAGOS: { nome: string; padrao: RegExp }[] = [
  { nome: "promete tudo sobre o assunto", padrao: /\b(?:tudo (?:sobre|o que (?:voce )?(?:precisa|deve|tem que) saber)|saiba tudo|o guia (?:completo|definitivo|supremo)|guia (?:completo|definitivo|supremo)|manual completo)\b/ },
  { nome: "guia definitivo", padrao: /\b(?:solucao definitiva|(?:metodo|manual|tutorial|receita|checklist|lista|passo a passo) definitiv[oa]|a unica coisa que voce precisa)\b/ },
  { nome: "revelação sem dizer qual", padrao: /\b(?:o segredo (?:que|dos|das|de|do|da)\b|a verdade (?:sobre|que)\b|(?:ninguem|nenhum \w+) (?:te )?(?:conta|fala|diz|avisa)\b|o que (?:\w+ ){0,3}(?:nao|nunca) (?:te )?(?:conta|contam|fala|falam|diz|dizem)\b|voce (?:nao )?vai (?:se )?(?:chocar|surpreender|nem acreditar)\b|vai te chocar)/ },
  { nome: "anúncio de uma era", padrao: /\b(?:a (?:nova )?era d[oae]s?\b|uma nova era\b|nova era\b|a revolucao d[oae]s?\b|o futuro d[oae]s?\b|chegou a hora de\b)/ },
];

/** O molde vago do título da capa, ou nulo. */
export function moldeVagoDaCapa(titulo: string): string | null {
  const baixo = semAcento(titulo);
  return MOLDES_VAGOS.find((m) => m.padrao.test(baixo))?.nome ?? null;
}

/** Reprova a capa que usa um molde vago: a capa promete uma coisa concreta (um número, um problema ou uma pergunta). */
export function verificarCapaVaga(slides: SlideDoCarrossel[]): string[] {
  const capa = slides[0];
  if (!capa || !ehCapa(capa.tipo)) return [];
  const molde = moldeVagoDaCapa(capa.titulo);
  return molde ? [`slide 1: o título da capa usa um molde vago (${molde}); diga a promessa concreta: um número de itens, um problema que a pessoa reconhece ou uma pergunta sobre uma dúvida real`] : [];
}

/** Verbos no imperativo mais comuns em capa (o infinitivo se acha pela terminação). */
const IMPERATIVOS = ["pare", "evite", "faca", "use", "escolha", "veja", "descubra", "aprenda", "salve", "cuide", "troque", "tire", "limpe", "lave", "escove", "comece", "conheca", "confira", "teste", "proteja", "melhore", "ganhe", "economize", "reduza", "tenha", "saiba"];

/** A capa tem número, pergunta ou verbo de ação? Sem nenhum dos três só gera aviso (vago não é proibido, só fraco). */
export function capaTemPromessaConcreta(titulo: string): boolean {
  const baixo = semAcento(titulo);
  if (/\d/.test(baixo) || /\?/.test(baixo) || Object.keys(EXTENSO).some((n) => new RegExp(`(?:^|[^a-z])${n}(?![a-z])`).test(baixo))) return true;
  const palavras = baixo.split(/[^a-z]+/).filter(Boolean);
  return palavras.some((p) => IMPERATIVOS.includes(p) || (p.length >= 5 && /(?:ar|er|ir|or)$/.test(p) && !["lugar", "melhor", "pior", "mulher", "valor", "calor", "dentro", "motor", "setor", "doutor", "amor", "dor"].includes(p)));
}

const contarPalavras = (t: string): number => (t.trim() === "" ? 0 : t.trim().split(/\s+/).length);
/** O piso de densidade: item ou passo com menos palavras que isso no texto fica fraco (só aviso). */
export const MINIMO_DE_PALAVRAS_DO_TEXTO = 8;

/** Texto que a pessoa lê sem tropeçar: a legenda e o título não são a mesma frase. */
function normalizado(t: string): string {
  return semAcento(t).replace(/[^a-z0-9]+/g, " ").trim();
}

/** Os avisos do método (nunca reprovam): capa vaga sem número, pergunta nem verbo de ação, legenda que repete o título da capa, e item ou passo curto demais. */
export function avisosDoMetodo(slides: SlideDoCarrossel[], legenda: string): string[] {
  const t = textosCarrossel.metodo;
  const avisos: string[] = [];
  const capa = slides[0];
  if (capa && ehCapa(capa.tipo) && !capaTemPromessaConcreta(capa.titulo)) avisos.push(t.capaFraca);
  if (capa && ehCapa(capa.tipo) && capa.titulo.trim()) {
    const titulo = normalizado(capa.titulo);
    const primeira = normalizado(legenda.split(/(?<=[.!?])\s+|\n/)[0] ?? "");
    if (titulo && primeira && (primeira === titulo || primeira.startsWith(titulo) || titulo.startsWith(primeira))) avisos.push(t.legendaRepeteACapa);
  }
  const curtos = slides.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => contaComoLista(s) && contarPalavras(s.texto ?? "") < MINIMO_DE_PALAVRAS_DO_TEXTO);
  if (curtos.length > 0) avisos.push(t.textoCurto(curtos.map(({ n }) => n)));
  return avisos;
}

/** A palavra da série de um rótulo ("Erro 2 de 3" vira "Erro"): pula artigo e palavra de até 2 letras ("A 4 de 4" não tem palavra e dá nulo). */
function palavraDoRotulo(rotulo: string | undefined): string | null {
  const palavras = (rotulo ?? "").replace(/\s*\d.*$/, "").trim().split(/\s+/).filter(Boolean);
  return palavras.find((p) => p.length > 2 && !/\d/.test(p)) ?? null;
}

const SERIES_DA_CAPA: [RegExp, string][] = [[/\bcausas?\b/, "Causa"], [/\berros?\b/, "Erro"], [/\bsinais\b|\bsinal\b/, "Sinal"], [/\bmitos?\b/, "Mito"]];

/**
 * O rótulo "N de M" dos itens, escrito por código como o do passo: os números são nossos e a palavra é a mesma em todos os itens (a do primeiro item que tem uma, ou a da capa se ela diz "causas", "erros",
 * "sinais" ou "mitos"), para a série não sair misturada ("Causa 1 de 3, Erro 3 de 3"). Sem palavra, "Dica". Com um item só, sem contagem. Devolve os slides com o rótulo certo.
 */
export function rotularItens(slides: SlideDoCarrossel[]): SlideDoCarrossel[] {
  const itens = slides.filter((s) => s.tipo === "item");
  const total = itens.length;
  const capa = slides[0];
  const daCapa = capa && ehCapa(capa.tipo) ? SERIES_DA_CAPA.find(([r]) => r.test(semAcento(`${capa.titulo}. ${capa.sub ?? ""}`)))?.[1] : undefined;
  const palavra = daCapa ?? itens.map((s) => palavraDoRotulo(s.rotulo)).find((p) => p !== null) ?? "Dica";
  let n = 0;
  return slides.map((s) => {
    if (s.tipo !== "item") return s;
    n += 1;
    return { ...s, rotulo: total > 1 ? `${palavra} ${n} de ${total}` : palavra };
  });
}
