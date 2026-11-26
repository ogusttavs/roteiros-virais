/**
 * E65 PR 1 e 2: as regras do carrossel que o código confere depois da IA (o prompt só pede) e na troca de texto pela pessoa. Funções puras, sem banco nem IA, para o teste unitário provar cada uma. Cada
 * motivo é uma frase que a segunda tentativa recebe para corrigir. Os limites de cada campo vêm da tabela do desenho (`CAMPOS_DO_TIPO` em `config/carrossel.ts`).
 */
import {
  CAMPOS_DO_TIPO,
  HASHTAGS,
  LIMITE_DA_LEGENDA_PALAVRAS,
  LINHA_FIXA_ANTES_DEPOIS_SAUDE,
  LISTAS_DO_TIPO,
  MAXIMO_DE_SLIDES_SEGUIDOS_DO_MESMO_TIPO,
  TEXTO_FIXO_DO_CONTEXTO_DA_FALA,
  TIPOS_COM_FOTO_DE_PACIENTE,
  TIPOS_COM_FOTO_OBRIGATORIA,
  TIPOS_PROIBIDOS_NA_SAUDE,
  ehCapa,
  limiteDoCampo,
  type ChaveDeCampo,
  type SlideDoCarrossel,
  type TipoDeSlide,
} from "@/config/carrossel";
import { acharFormulasDeMaquina, motivosDasFormulas } from "@/ia/formulas-de-maquina";

import { distribuirFotos } from "./fotos";
import { rotularItens } from "./metodo";

export function contarPalavras(texto: string): number {
  return texto.trim() === "" ? 0 : texto.trim().split(/\s+/).length;
}

/** Uma citação mais curta que isso está contida em qualquer texto e não prova que o cliente falou. */
export const MINIMO_DE_PALAVRAS_DA_CITACAO = 4;

const TEM_ANO = /(?:^|\D)(?:19|20)\d{2}(?:\D|$)/;

/** O slide como a IA escreve: todos os campos, vazios quando o tipo não usa (sem opcionais nem nulos, para a gramática da saída ficar pequena). */
export type SlideDaSaida = {
  tipo: TipoDeSlide;
  rotulo: string;
  titulo: string;
  /** A linha de apoio da capa, o texto do passo, do item e da chamada, a frase do dado e a fala do cliente. */
  texto: string;
  antes: string;
  depois: string;
  valor: string;
  unidade: string;
  fonte: string;
  referencia: string;
  quem: string;
  contexto: string;
  linhas: string[];
  acoes: string[];
};

const limpo = (v: string | undefined): string => (v ?? "").trim();

/**
 * Da saída da IA para o que o slide guarda: cada tipo fica só com os campos que usa, com os nomes do desenho; o número e o total dos passos, o rodapé de saúde e o fim do contexto da fala são escritos por código.
 */
export function slidesDaSaida(saida: SlideDaSaida[], opcoes: { ramoSaude: boolean }): SlideDoCarrossel[] {
  const totalDePassos = saida.filter((s) => s.tipo === "passo").length;
  let passo = 0;
  return rotularItens(saida.map((s): SlideDoCarrossel => {
    const opcional = (valor: string, chave: ChaveDeCampo) => (limpo(valor) ? { [chave]: limpo(valor) } : {});
    switch (s.tipo) {
      case "capa-foto":
      case "capa-texto":
        return { tipo: s.tipo, titulo: limpo(s.titulo), ...opcional(s.rotulo, "rotulo"), ...opcional(s.texto, "sub") };
      case "passo":
        passo += 1;
        return { tipo: s.tipo, titulo: limpo(s.titulo), texto: limpo(s.texto), numero: passo, ...(totalDePassos > 1 ? { de: totalDePassos } : {}) };
      case "item":
        return { tipo: s.tipo, titulo: limpo(s.titulo), texto: limpo(s.texto), ...opcional(s.rotulo, "rotulo") };
      case "antes-depois":
        return { tipo: s.tipo, titulo: limpo(s.titulo), antes: limpo(s.antes), depois: limpo(s.depois), ...(opcoes.ramoSaude ? { rodape: LINHA_FIXA_ANTES_DEPOIS_SAUDE } : {}) };
      case "dado":
        return { tipo: s.tipo, titulo: "", valor: limpo(s.valor), ...opcional(s.unidade, "unidade"), frase: limpo(s.texto), fonte: limpo(s.fonte) || null, referencia: limpo(s.referencia) };
      case "prova-fala": {
        const contexto = limpo(s.contexto).replace(/\.?\s*Publicado com autoriza[cç][aã]o\.?$/i, "").trim();
        return { tipo: s.tipo, titulo: "", citacao: limpo(s.texto), quem: limpo(s.quem), contexto: `${contexto ? `${contexto.replace(/\.$/, "")}. ` : ""}${TEXTO_FIXO_DO_CONTEXTO_DA_FALA}` };
      }
      case "prova-resultado":
        return { tipo: s.tipo, titulo: limpo(s.titulo), ...(opcoes.ramoSaude ? { rodape: LINHA_FIXA_ANTES_DEPOIS_SAUDE } : {}) };
      case "resumo":
        return { tipo: s.tipo, titulo: limpo(s.titulo), linhas: s.linhas.map(limpo).filter(Boolean) };
      case "chamada":
        return { tipo: s.tipo, titulo: limpo(s.titulo), texto: limpo(s.texto), acoes: s.acoes.map(limpo).filter(Boolean) };
      case "noticia":
        return { tipo: s.tipo, titulo: limpo(s.titulo), veiculo: limpo(s.fonte), data: limpo(s.referencia) };
    }
  }));
}

/** Todo o texto de um slide, na ordem em que aparece, para o verificador de fatos e a conformidade lerem. */
export function textoDoSlide(s: SlideDoCarrossel): string[] {
  return [s.rotulo, s.titulo, s.sub, s.texto, s.antes, s.depois, s.valor && `${s.valor}${s.unidade ?? ""}`, s.frase, s.fonte, s.citacao, s.quem, s.contexto, ...(s.linhas ?? []), ...(s.acoes ?? [])].filter((t): t is string => Boolean(t && t.trim()));
}

/** A ordem e a forma da lista: quantidade, capa primeiro, chamada por último, nunca três do mesmo tipo seguidos. */
export function verificarOrdemDosSlides(slides: { tipo: TipoDeSlide }[], quantidade: number): string[] {
  const motivos: string[] = [];
  if (slides.length !== quantidade) motivos.push(`carrossel: ${slides.length} slides, o pedido era de exatamente ${quantidade}`);
  if (slides.length > 0 && !ehCapa(slides[0].tipo)) motivos.push('carrossel: o primeiro slide precisa ser uma capa (capa-foto ou capa-texto)');
  if (slides.length > 0 && slides[slides.length - 1].tipo !== "chamada") motivos.push('carrossel: o último slide precisa ser do tipo "chamada"');
  slides.forEach((s, i) => {
    if (i > 0 && ehCapa(s.tipo)) motivos.push(`slide ${i + 1}: o tipo "${s.tipo}" só pode ser o primeiro`);
    if (i < slides.length - 1 && s.tipo === "chamada") motivos.push(`slide ${i + 1}: o tipo "chamada" só pode ser o último`);
  });
  let seguidos = 1;
  for (let i = 1; i < slides.length; i += 1) {
    seguidos = slides[i].tipo === slides[i - 1].tipo ? seguidos + 1 : 1;
    if (seguidos > MAXIMO_DE_SLIDES_SEGUIDOS_DO_MESMO_TIPO) {
      motivos.push(`slides ${i - seguidos + 2} a ${i + 1}: ${seguidos} slides seguidos do tipo "${slides[i].tipo}", misture os tipos`);
      break;
    }
  }
  return motivos;
}

const semAcentoMinusculo = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Quais slides recebem foto, na ordem em que as fotos são distribuídas (a conta é a mesma do render): o passo e o antes e depois com foto têm limites menores. Com `quantidadeDePaciente` (marca de saúde), as
 * fotos de paciente são contadas à parte e só entram em antes e depois e em resultado.
 */
export function slidesComFoto(slides: SlideDoCarrossel[], quantidadeDeFotos: number, quantidadeDePaciente?: number): boolean[] {
  const comuns = Array.from({ length: quantidadeDeFotos }, (_, i) => ({ id: i + 1, dePaciente: false }));
  const pacientes = Array.from({ length: quantidadeDePaciente ?? 0 }, (_, i) => ({ id: quantidadeDeFotos + i + 1, dePaciente: true }));
  return slidesComFotoDasFotos(slides, [...comuns, ...pacientes], quantidadeDePaciente !== undefined);
}

/** O mesmo, com as fotos de verdade (as que o carrossel guarda). */
export function slidesComFotoDasFotos(slides: SlideDoCarrossel[], fotos: { id: number; dePaciente?: boolean }[], separarPaciente: boolean): boolean[] {
  return distribuirFotos(slides, fotos, separarPaciente).map((d, i) => (slides[i].tipo === "antes-depois" ? d.foto !== null && d.fotoDepois !== null : d.foto !== null));
}

/** O que está errado num valor de campo: vazio (obrigatório), palavras ou caracteres a mais; nulo se cabe. Palavras só contam nos campos de mais de uma palavra (o valor e a unidade do dado contam caracteres). */
export function excessoDoCampo(tipo: TipoDeSlide, chave: ChaveDeCampo, valor: string, comFoto: boolean): { tipo: "vazio" | "palavras" | "caracteres"; n: number; limite: number } | null {
  const limite = limiteDoCampo(tipo, chave, comFoto);
  if (!limite) return null;
  const palavras = contarPalavras(valor);
  if (palavras === 0) return limite.obrigatorio ? { tipo: "vazio", n: 0, limite: limite.palavras } : null;
  if (limite.palavras > 1 && palavras > limite.palavras) return { tipo: "palavras", n: palavras - limite.palavras, limite: limite.palavras };
  if (valor.trim().length > limite.caracteres) return { tipo: "caracteres", n: valor.trim().length - limite.caracteres, limite: limite.caracteres };
  return null;
}

/** O motivo (frase para a pessoa ou para a IA) de um valor passar do limite do campo, ou nulo se cabe. */
export function motivoDoCampo(tipo: TipoDeSlide, chave: ChaveDeCampo, valor: string, comFoto: boolean): string | null {
  const e = excessoDoCampo(tipo, chave, valor, comFoto);
  if (!e) return null;
  if (e.tipo === "vazio") return "vazio";
  return e.tipo === "palavras" ? `passou ${e.n} ${e.n === 1 ? "palavra" : "palavras"} (o limite é ${e.limite})` : `passou ${e.n} caracteres (o limite é ${e.limite})`;
}

/** O excesso pequeno que a 2ª tentativa tolera: até 3 palavras a mais E até 20% de caracteres acima do limite. */
export const EXCESSO_PEQUENO_DE_PALAVRAS = 3;
export const EXCESSO_PEQUENO_DE_CARACTERES = 0.2;

function excessoEhPequeno(palavras: number, limitePalavras: number, caracteres: number, limiteCaracteres: number): boolean {
  return palavras <= limitePalavras + EXCESSO_PEQUENO_DE_PALAVRAS && caracteres <= Math.floor(limiteCaracteres * (1 + EXCESSO_PEQUENO_DE_CARACTERES));
}

/** O campo passou do limite, mas só um pouco (não vale para vazio nem para o valor e a unidade do dado, que quebram o desenho). */
export function excessoPequenoDoCampo(tipo: TipoDeSlide, chave: ChaveDeCampo, valor: string, comFoto: boolean): boolean {
  const e = excessoDoCampo(tipo, chave, valor, comFoto);
  const limite = limiteDoCampo(tipo, chave, comFoto);
  if (!e || e.tipo === "vazio" || !limite || limite.palavras <= 1) return false;
  return excessoEhPequeno(contarPalavras(valor), limite.palavras, valor.trim().length, limite.caracteres);
}

const NOME_DO_CAMPO: Record<ChaveDeCampo, string> = {
  rotulo: "rótulo",
  titulo: "título",
  sub: "linha de apoio",
  texto: "texto",
  antes: "antes",
  depois: "depois",
  valor: "valor",
  unidade: "unidade",
  frase: "frase",
  fonte: "fonte",
  referencia: "referência",
  citacao: "fala",
  quem: "quem falou",
  contexto: "contexto",
  veiculo: "veículo",
  data: "data",
};

/**
 * Os limites de cada campo de cada tipo, a fonte e o ano do `dado`, os tipos que o ramo de saúde não aceita, as fotos que o pedido prometeu (capa-foto e prova-resultado só existem com foto) e a citação do
 * `prova-fala`, que só vale se for uma frase que a própria pessoa disse (está nas falas DELA, nunca nas de outros criadores, na notícia ou no tema) e tiver ao menos `MINIMO_DE_PALAVRAS_DA_CITACAO` palavras.
 */
export function verificarLimitesDosSlides(slides: SlideDoCarrossel[], opcoes: OpcoesDosLimites & { tolerarExcessoPequeno?: boolean }): string[] {
  return conferirLimites(slides, opcoes).filter((m) => !(opcoes.tolerarExcessoPequeno && m.pequeno)).map((m) => m.texto);
}

/** Os números dos slides que só passaram do tamanho por pouco (os que a 2ª tentativa deixa sair, marcados para encurtar). */
export function slidesComExcessoPequeno(slides: SlideDoCarrossel[], opcoes: OpcoesDosLimites): number[] {
  return [...new Set(conferirLimites(slides, opcoes).filter((m) => m.pequeno).map((m) => m.slide))];
}

export type OpcoesDosLimites = { ramoSaude: boolean; fotosPrometidas?: number; fotosDePacientePrometidas?: number; falasDoCliente?: string };
type MotivoDeLimite = { texto: string; pequeno: boolean; slide: number };

function conferirLimites(slides: SlideDoCarrossel[], opcoes: OpcoesDosLimites): MotivoDeLimite[] {
  const achados: MotivoDeLimite[] = [];
  let slideAtual = 0;
  const motivos = {
    push: (texto: string, pequeno = false) => {
      achados.push({ texto, pequeno, slide: slideAtual });
    },
  };
  const falasNormalizadas = opcoes.falasDoCliente === undefined ? null : semAcentoMinusculo(opcoes.falasDoCliente);
  const comFotoObrigatoria = slides.filter((s) => TIPOS_COM_FOTO_OBRIGATORIA.has(s.tipo)).length;
  if (opcoes.ramoSaude && opcoes.fotosPrometidas !== undefined) {
    // Saúde: foto comum (o lugar, a equipe) e foto de paciente nunca se misturam. Capa com foto e notícia usam a comum; antes e depois (duas fotos) e resultado (uma) só usam a de paciente.
    const comuns = slides.filter((s) => TIPOS_COM_FOTO_OBRIGATORIA.has(s.tipo) && !TIPOS_COM_FOTO_DE_PACIENTE.has(s.tipo)).length;
    const dePaciente = slides.reduce((n, s) => n + (s.tipo === "prova-resultado" ? 1 : s.tipo === "antes-depois" ? 2 : 0), 0);
    const temPaciente = opcoes.fotosDePacientePrometidas ?? 0;
    if (comuns > opcoes.fotosPrometidas) motivos.push(`carrossel: ${comuns} slides pedem foto (capa-foto) e o cliente tem ${opcoes.fotosPrometidas}; sem foto use capa-texto`);
    if (dePaciente > temPaciente) motivos.push(`carrossel: antes-depois e prova-resultado só usam foto de paciente (o cliente tem ${temPaciente}, e o antes e depois leva duas); sem foto de paciente não use antes-depois nem prova-resultado`);
  } else if (opcoes.fotosPrometidas !== undefined && comFotoObrigatoria > opcoes.fotosPrometidas) {
    motivos.push(`carrossel: ${comFotoObrigatoria} slides pedem foto (capa-foto e prova-resultado) e o cliente tem ${opcoes.fotosPrometidas}; sem foto use capa-texto e não use prova-resultado`);
  }
  const comFoto = opcoes.ramoSaude ? slidesComFoto(slides, opcoes.fotosPrometidas ?? 0, opcoes.fotosDePacientePrometidas ?? 0) : slidesComFoto(slides, opcoes.fotosPrometidas ?? 0);
  slides.forEach((s, i) => {
    const n = i + 1;
    slideAtual = n;
    const campos = CAMPOS_DO_TIPO[s.tipo];
    for (const chave of Object.keys(campos) as ChaveDeCampo[]) {
      const valor = chave === "fonte" ? (s.fonte ?? "") : ((s[chave as keyof SlideDoCarrossel] as string | undefined) ?? "");
      const motivo = motivoDoCampo(s.tipo, chave, valor, comFoto[i]);
      if (motivo) motivos.push(motivo === "vazio" ? `slide ${n} (${s.tipo}): sem ${NOME_DO_CAMPO[chave]}` : `slide ${n} (${s.tipo}): ${NOME_DO_CAMPO[chave]}, ${motivo}`, excessoPequenoDoCampo(s.tipo, chave, valor, comFoto[i]));
    }
    const lista = LISTAS_DO_TIPO[s.tipo];
    if (lista) {
      const itens = ((s[lista.chave] as string[] | undefined) ?? []).filter((l) => l.trim());
      if (itens.length < lista.minimo || itens.length > lista.maximo) {
        motivos.push(`slide ${n} (${s.tipo}): ${lista.chave} tem ${itens.length} itens, o pedido é ${lista.minimo === lista.maximo ? `de ${lista.minimo}` : `de ${lista.minimo} a ${lista.maximo}`}`);
      }
      itens.forEach((l, k) => {
        if (contarPalavras(l) > lista.palavras || l.trim().length > lista.caracteres) {
          motivos.push(`slide ${n} (${s.tipo}): ${lista.chave} ${k + 1} passa de ${lista.palavras} palavras ou ${lista.caracteres} caracteres`, excessoEhPequeno(contarPalavras(l), lista.palavras, l.trim().length, lista.caracteres));
        }
      });
    }
    if (s.tipo === "dado") {
      if (!s.fonte || !s.fonte.trim()) motivos.push(`slide ${n} (dado): sem a fonte`);
      if (!TEM_ANO.test(`${s.referencia ?? ""} ${s.fonte ?? ""}`)) motivos.push(`slide ${n} (dado): a referência precisa ter o ano ("O que é, 2026")`);
      if (!/\d/.test(s.valor ?? "")) motivos.push(`slide ${n} (dado): um dado tem número, e este não tem`);
    }
    if (opcoes.ramoSaude) {
      for (const texto of textoDoSlide(s)) {
        const promessa = promessaEmSaude(texto);
        if (promessa) motivos.push(`slide ${n}: em saúde o slide não pode prometer resultado, cura, garantia nem prazo; tire "${promessa}"`);
      }
    }
    if (opcoes.ramoSaude && TIPOS_PROIBIDOS_NA_SAUDE.has(s.tipo)) motivos.push(`slide ${n}: o tipo "${s.tipo}" não vale num ramo de saúde`);
    if (s.tipo === "prova-fala" && falasNormalizadas !== null) {
      const citacao = semAcentoMinusculo(s.citacao ?? "");
      if (!citacao || contarPalavras(citacao) < MINIMO_DE_PALAVRAS_DA_CITACAO || !falasNormalizadas.includes(citacao)) {
        motivos.push(`slide ${n} (prova-fala): a citação precisa ser uma frase que o cliente disse de verdade (que está no perfil), escrita igual, com pelo menos ${MINIMO_DE_PALAVRAS_DA_CITACAO} palavras; sem uma frase assim, não use este tipo`);
      }
    }
  });
  return achados;
}

/** Letra sem acento e em minúscula, uma por uma (o texto fica com o mesmo tamanho, para o trecho achado voltar como a pessoa escreveu). */
const semAcentoLetraPorLetra = (t: string): string => Array.from(t, (c) => c.normalize("NFD")[0].toLowerCase()).join("");

/**
 * O que um slide de ramo de saúde não pode prometer: resultado, cura, garantia nem PRAZO ("em uma sessão", "em 7 dias"). O conselho da profissão proíbe (R-CONF-07). Devolve o primeiro trecho achado,
 * como a pessoa escreveu, ou nulo. A tela barra a troca de texto e o código reprova a geração com isto.
 */
const PROMESSAS_DE_SAUDE: RegExp[] = [
  // Prazo de RESULTADO: a palavra do resultado perto do prazo ("resultado em 7 dias", "dentes brancos em uma semana"). "Volte em 6 meses" e "troque a escova em 3 meses" são orientação, não promessa.
  /\b(?:resultados?|dentes? branc\w+|sorriso \w+|branque\w+|fica(?:m|r|ra|rao)?|resolv\w+|elimin\w+|transform\w+|alinh\w+) (?:[a-z]+ ){0,3}em (?:apenas |so |ate |somente )?(?:uma?|duas?|tres|quatro|cinco|\d+) (?:sessao|sessoes|dia|dias|semana|semanas|hora|horas|mes|meses)\b/,
  /\bem (?:apenas |so |somente )(?:uma?|duas?|tres|quatro|cinco|\d+) (?:sessao|sessoes|dia|dias|semana|semanas|hora|horas)\b/,
  /\bem (?:uma?|1) sessao\b/,
  // Garantia como promessa. "Nenhum dentista garante" (a frase que desmente a promessa) passa.
  /\bgarant(?:ido|ida|idos|idas|imos|iremos|o)\b/,
  /\bgarantia de (?:resultado|sucesso|cura|eficacia)/,
  /\bresultados? (?:garantid|imediat|certo|rapid|definitiv)\w*/,
  /\bvolta ao branco/,
  /\bficam? branc[oa]s?\b/,
  /\b(?:cura|curar|curamos|curado|curada)\b/,
  /100 ?%/,
  // "Definitivo" só como promessa de resultado; "dente definitivo" e "prótese definitiva" são o nome da peça.
  /\b(?:para sempre|definitivamente|solucao definitiva|cura definitiva|tratamento definitivo|clareamento definitivo|resultado definitivo)\b/,
  // "Mesmo sem dor, vá ao dentista" é conselho; a promessa é "sem dor nenhuma", "indolor", "procedimento sem dor".
  /\bsem dor (?:nenhuma|alguma)\b/,
  /\b(?:totalmente|completamente) sem dor\b|\b(?:procedimento|tratamento|atendimento|clareamento) sem dor\b|\bindolor\w*/,
  /\bsem riscos?\b/,
];

/** As palavras que desmentem a promessa quando aparecem pouco antes dela, na mesma frase ("não dura para sempre", "nunca é garantido", "nenhum dentista garante", "é mito que cura"). */
const NEGACOES = new Set(["nao", "nunca", "nenhum", "nenhuma", "ninguem", "nem", "mito", "jamais"]);
const JANELA_DA_NEGACAO = 5;
/** A negação logo depois do trecho ("resultado garantido não existe", "isso é mito"). */
const NEGACAO_DEPOIS = /^[ ,]*(?:nao (?:existe|ha|e|passa)|e (?:um )?mito)/;
const FIM_DE_FRASE = [".", "!", "?", ";", ":", ",", String.fromCharCode(10)];

/** O trecho achado é a frase que DESMENTE a promessa, não a promessa (B1 da revisão de 26/11/2026)? Olha as 5 palavras antes, até a pontuação, e a negação logo depois. */
function trechoNegado(baixo: string, inicio: number, fim: number): boolean {
  const antes = baixo.slice(0, inicio);
  const frase = antes.slice(Math.max(...FIM_DE_FRASE.map((c) => antes.lastIndexOf(c))) + 1);
  const palavras = frase.split(/\s+/).filter(Boolean).slice(-JANELA_DA_NEGACAO);
  if (palavras.some((w) => NEGACOES.has(w))) return true;
  return NEGACAO_DEPOIS.test(baixo.slice(fim));
}

export function promessaEmSaude(texto: string): string | null {
  const baixo = semAcentoLetraPorLetra(texto);
  let primeiro: { inicio: number; fim: number } | null = null;
  for (const padrao of PROMESSAS_DE_SAUDE) {
    for (const m of baixo.matchAll(new RegExp(padrao.source, "g"))) {
      const inicio = m.index ?? 0;
      const fim = inicio + m[0].length;
      if (trechoNegado(baixo, inicio, fim)) continue;
      if (primeiro === null || inicio < primeiro.inicio) primeiro = { inicio, fim };
      break;
    }
  }
  return primeiro ? texto.slice(primeiro.inicio, primeiro.fim).trim() : null;
}

/**
 * R-COPY-26 (texto com cara de máquina) nos slides: o detector é o MESMO do roteiro (`ia/formulas-de-maquina.ts`, lista fechada, sem lista própria). A capa faz o papel do gancho, os slides do meio do corpo e a
 * chamada do último bloco. Quem chama decide o que fazer: reprova na 1ª tentativa e só avisa na 2ª, como o roteiro.
 */
export function formulasDeMaquinaDosSlides(slides: SlideDoCarrossel[], fontes: string): string[] {
  const capa = slides[0];
  const chamada = slides[slides.length - 1];
  const meio = slides.slice(1, -1);
  const achados = acharFormulasDeMaquina(
    {
      gancho: capa ? textoDoSlide(capa).join(". ") : "",
      corpo: meio.map((m) => textoDoSlide(m).join(". ")).join(" "),
      chamada: chamada && chamada !== capa ? textoDoSlide(chamada).join(". ") : "",
    },
    { fontes },
  );
  return motivosDasFormulas(achados.slice(0, 3));
}

/** A legenda e as hashtags. */
export function verificarLegenda(legenda: string, hashtags: string[]): string[] {
  const motivos: string[] = [];
  const palavras = contarPalavras(legenda);
  if (palavras === 0) motivos.push("legenda: vazia");
  if (palavras > LIMITE_DA_LEGENDA_PALAVRAS) motivos.push(`legenda: ${palavras} palavras, o limite é ${LIMITE_DA_LEGENDA_PALAVRAS}`);
  const limpas = normalizarHashtags(hashtags);
  if (limpas.length < HASHTAGS.min || limpas.length > HASHTAGS.max) motivos.push(`hashtags: ${limpas.length}, o pedido é de ${HASHTAGS.min} a ${HASHTAGS.max}`);
  return motivos;
}

/** Põe o # na frente, tira espaço e repetição. */
export function normalizarHashtags(hashtags: string[]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const h of hashtags) {
    const miolo = h.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!miolo || vistas.has(miolo.toLowerCase())) continue;
    vistas.add(miolo.toLowerCase());
    saida.push(`#${miolo}`);
  }
  return saida;
}

/** Os campos que a pessoa pode trocar num slide, na ordem em que a tela os mostra (o que o tipo tem; o número do passo, o rodapé e as linhas fixas são de código). */
export function camposEditaveis(tipo: TipoDeSlide): ChaveDeCampo[] {
  return Object.keys(CAMPOS_DO_TIPO[tipo]) as ChaveDeCampo[];
}
