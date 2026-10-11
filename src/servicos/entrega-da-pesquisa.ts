/**
 * E54 (parte 2): do que o roteiro devolveu para o que fica guardado e o que o modelo recebe, do lado da pesquisa na hora. Puro, testado por tabela.
 *
 * - `paraEntradaDaPesquisa`: os dados que a pessoa marcou, na forma que a entrada e as fontes dos fatos do roteiro recebem (com a data por extenso).
 * - `montarEntregaDaPesquisa`: o que o modelo devolveu em `entregaDaPesquisa` (os três ganchos, o que pode aparecer, os dados usados, o "Atenção"),
 *   depois do código. O modelo escreve a parte que depende do assunto; o que é regra (dado antigo, premissa mantida, saúde, preço, política) o código
 *   escreve, e o que o modelo escreveu passa pelas mesmas travas do roteiro: o item que falha SAI, em vez de derrubar o roteiro por um item secundário.
 */
import type { AchadoDaPesquisa, EntregaDaPesquisa, PesquisaDeOrigemGuardada } from "@/db/schema";
import type { PesquisaNaEntrada, SaidaRoteiro } from "@/ia/prompts/roteiro";
import { encontrarProblemas } from "@/lib/regras-de-texto";
import { textosRoteiro } from "@/textos/roteiro";

import { dadosForaDasFontes, ehPrevisaoDePublico, limparLinha, semAcento, tokensNumericos } from "./conferencia-da-pesquisa";
import { enderecoHttpsSeguro } from "./noticias-assuntos";


const GANCHOS_NO_MAXIMO = 3;
const OBJECOES_NO_MAXIMO = 4;
const ATENCAO_NO_MAXIMO = 8;
/** O corte de cada frase do "Atenção"; a premissa mantida tem o dela, para a frase que pede a conferência nunca ser a cortada. */
const ATENCAO_FRASE_MAXIMO = 400;
const AVISO_DA_PREMISSA_MAXIMO = 220;

export type Cuidado = "saude" | "preco" | "politica";

/** "2026-08-31" vira "31 de agosto de 2026" (a data da página, sem fuso: é uma data, não um instante). */
export function dataPorExtensoDaPagina(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

/** O dia da pesquisa por extenso, no fuso de São Paulo (o que a pessoa viu). */
function feitaEmPorExtenso(pesquisadaEm: string): string | null {
  const data = new Date(pesquisadaEm);
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(data);
}

export function paraEntradaDaPesquisa(pesquisa: PesquisaDeOrigemGuardada): PesquisaNaEntrada {
  return {
    feitaEm: feitaEmPorExtenso(pesquisa.pesquisadaEm),
    dados: pesquisa.dados.map((d) => ({
      id: d.id,
      fonteNome: d.fonteNome,
      dataTexto: dataPorExtensoDaPagina(d.dataDaPagina),
      texto: d.texto,
      citacao: d.citacao,
      antigo: d.antigo,
    })),
    posicaoDaPessoa: pesquisa.posicaoDaPessoa,
    decisaoDaPremissa: pesquisa.decisaoDaPremissa,
    avisoDaPremissa: pesquisa.avisoDaPremissa,
  };
}

/** A frase do modelo como a pessoa a lê (sem marcador, sem negrito, sem travessão, numa linha), cortada em `maximo`. */
function limpar(texto: string | null | undefined, maximo: number): string {
  const limpo = limparLinha(texto ?? "");
  return limpo.length > maximo ? limpo.slice(0, maximo).trimEnd() : limpo;
}

function chave(texto: string): string {
  return semAcento(texto).replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

/** Corta no fim de uma palavra e fecha a frase com ponto (a frase que pede a conferência vem depois e nunca é a cortada). */
function aviso(texto: string, maximo: number): string {
  const limpo = limpar(texto, 1000);
  const cortado = limpo.length > maximo ? limpo.slice(0, maximo).replace(/\s+\S*$/, "").trimEnd() : limpo;
  const comPonto = /[.!?]$/.test(cortado) ? cortado : `${cortado}.`;
  return comPonto.charAt(0).toUpperCase() + comPonto.slice(1);
}

/** O cuidado que o assunto pede, por código, sobre o tema, os dados e o que o roteiro escreveu (além do que o modelo disse). */
export function detectarCuidados(texto: string): Cuidado[] {
  const t = semAcento(texto);
  const achados: Cuidado[] = [];
  if (/\b(eleicao|eleicoes|eleitoral|candidat\w*|partido|partidos|voto|votos|votar|votacao|congresso|senado|camara dos deputados|deputad\w*|presidente|governador|prefeito|ministro|politic\w*|pec)\b/.test(t)) achados.push("politica");
  if (/\b(saude|doenca|doencas|remedio|remedios|medicamento|medicamentos|tratamento|vacina|vacinas|sintoma|sintomas|cura|anvisa|cancer|diabetes)\b/.test(t)) achados.push("saude");
  if (/\b(preco|precos|valor|valores|custa|custo|custos|desconto|inflacao|juros|reajuste)\b/.test(t)) achados.push("preco");
  return achados;
}

/** O texto passa nas regras de texto do projeto (sem jargão nem emoji nem travessão) e não carrega endereço nem menção. */
function textoLimpo(texto: string): boolean {
  return encontrarProblemas(texto).length === 0 && !/https?:\/\/|www\.|@/i.test(texto);
}

/** Os dados que um texto usou, por código: o número do dado (com unidade e escala) ou o nome da fonte aparece no texto. */
export function idsUsadosNoTexto(dados: AchadoDaPesquisa[], texto: string): number[] {
  const chavesDoTexto = new Set(tokensNumericos(texto).map((t) => t.chave));
  const normalizado = semAcento(texto);
  return dados
    .filter((d) => {
      const numeros = tokensNumericos(d.texto).map((t) => t.chave);
      if (numeros.some((n) => chavesDoTexto.has(n))) return true;
      return citaOLugar(normalizado, semAcento(d.fonteNome));
    })
    .map((d) => d.id);
}

/** O nome da fonte aparece no texto como palavra inteira ("Exame" não está em "exames"). Os dois já sem acento e em minúscula. */
function citaOLugar(textoNormalizado: string, nome: string): boolean {
  const limpo = nome.trim();
  if (limpo === "") return false;
  const escapado = limpo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapado}(?![\\p{L}\\p{N}])`, "u").test(textoNormalizado);
}

function idsUsadosPorCodigo(pesquisa: PesquisaDeOrigemGuardada, textoDoRoteiro: string): number[] {
  return idsUsadosNoTexto(pesquisa.dados, textoDoRoteiro);
}

const PREFIXO_DO_OUTRO_LADO = /^\s*do outro lado:\s*/i;

/** A frase do dado como a pessoa a lê: sem o "Do outro lado:" da busca, com a primeira letra maiúscula. */
export function fraseDoDado(achado: Pick<AchadoDaPesquisa, "texto">): { dado: string; outroLado: boolean } {
  const outroLado = PREFIXO_DO_OUTRO_LADO.test(achado.texto);
  const limpo = achado.texto.replace(PREFIXO_DO_OUTRO_LADO, "").trim();
  return { dado: limpo.charAt(0).toUpperCase() + limpo.slice(1), outroLado };
}

/** Uma fonte da lista "Fontes" do roteiro: o número pequeno que a fala usa, quem publicou, quando, a frase e o endereço (só https). */
export type FonteDoRoteiro = { numero: number; id: number; fonte: string; data: string | null; dado: string; url: string | null };

/** O que o roteiro com pesquisa mostra além do roteiro: o selo, o "Atenção", o "pode aparecer" e as fontes. */
export type PesquisaDoRoteiro = {
  dados: number;
  atencao: string[];
  respostas: { objecao: string; resposta: string }[];
  fontes: FonteDoRoteiro[];
};

/**
 * A pesquisa como a tela do roteiro a lê (E54, parte 3): as fontes são as que a entrega declarou (as do modelo mais as que o código achou no texto), numeradas pela ordem em que a
 * pessoa as viu na pesquisa; sem entrega (roteiro de antes, ou a entrega que o modelo não devolveu), valem todos os dados que ela marcou.
 */
export function pesquisaDoRoteiro(pesquisa: PesquisaDeOrigemGuardada, entrega: EntregaDaPesquisa | null): PesquisaDoRoteiro {
  const ids = new Set(entrega && entrega.fontes.length > 0 ? entrega.fontes : pesquisa.dados.map((d) => d.id));
  const fontes = pesquisa.dados
    .filter((d) => ids.has(d.id))
    .map((d, indice): FonteDoRoteiro => {
      const { dado } = fraseDoDado(d);
      return {
        numero: indice + 1,
        id: d.id,
        fonte: d.fonteNome,
        data: dataPorExtensoDaPagina(d.dataDaPagina),
        dado,
        url: enderecoHttpsSeguro(d.url),
      };
    });
  return { dados: pesquisa.dados.length, atencao: entrega?.atencao ?? [], respostas: entrega?.oQueVaoTeResponder ?? [], fontes };
}

/**
 * Para cada parágrafo, os números das fontes que ele usa (por código: o número do dado ou o nome da fonte aparece na frase). Vazio quando o parágrafo não usa nenhuma. O roteiro
 * da pessoa pode ter sido editado: o que vale é o texto de agora.
 */
export function fontesDosParagrafos(paragrafos: string[], pesquisa: PesquisaDeOrigemGuardada, fontes: FonteDoRoteiro[]): number[][] {
  const numeroPorId = new Map(fontes.map((f) => [f.id, f.numero]));
  return paragrafos.map((paragrafo) => {
    const ids = idsUsadosNoTexto(pesquisa.dados, paragrafo);
    return ids.map((id) => numeroPorId.get(id)).filter((n): n is number => n !== undefined);
  });
}

export type ContextoDaEntrega = {
  /** O texto das fontes dos fatos do roteiro (as mesmas `fontesDosFatos`): contra ele o que o modelo escreveu é conferido. */
  fontes: string;
  /** Tudo o que o roteiro escreveu (gancho, corpo, cartões, legenda): de onde sai o que foi usado, por código. */
  textoDoRoteiro: string;
  /** O gancho do roteiro (Reels falado); vazio em Story e sem fala. */
  gancho: string;
};

/**
 * O que o modelo devolveu, depois do código. Nulo sem pesquisa ou sem entrega. Os ganchos: o primeiro é SEMPRE o recomendado e, no Reels falado, é o próprio gancho do roteiro.
 * O que pode aparecer: cada objeção começa por "Pode aparecer" (o código põe, se faltar), previsão de público e número fora das fontes saem. As fontes: as que o modelo
 * disse e as que o código acha no texto (o dado antigo usado e não declarado não escapa do aviso). O "Atenção": primeiro o que é regra (premissa mantida, cuidado do
 * assunto, dado antigo ou sem data que o roteiro usou), depois o que o modelo escreveu e passou nas travas.
 */
export function montarEntregaDaPesquisa(
  entrega: SaidaRoteiro["entregaDaPesquisa"] | undefined,
  pesquisa: PesquisaDeOrigemGuardada | null | undefined,
  contexto: ContextoDaEntrega = { fontes: "", textoDoRoteiro: "", gancho: "" },
): EntregaDaPesquisa | null {
  if (!entrega || !pesquisa) return null;
  const confere = (texto: string) => textoLimpo(texto) && dadosForaDasFontes(texto, contexto.fontes).length === 0;

  const idsMarcados = new Set(pesquisa.dados.map((d) => d.id));
  const citados = [...new Set([...entrega.fontes, ...idsUsadosPorCodigo(pesquisa, contexto.textoDoRoteiro)])].filter((id) => idsMarcados.has(id));
  const fontes = citados.length > 0 ? citados : pesquisa.dados.map((d) => d.id);

  // Os ganchos: o do roteiro primeiro (Reels falado), depois os alternativos que passam nas travas, sem repetir.
  const vistos = new Set<string>();
  const ganchos: EntregaDaPesquisa["ganchos"] = [];
  const poeGancho = (texto: string, aprovadoPorCodigo: boolean) => {
    const limpo = limpar(texto, 300);
    if (limpo === "" || vistos.has(chave(limpo)) || ganchos.length >= GANCHOS_NO_MAXIMO) return;
    if (!aprovadoPorCodigo && !confere(limpo)) return;
    vistos.add(chave(limpo));
    ganchos.push({ texto: limpo, recomendado: false });
  };
  if (contexto.gancho.trim() !== "") poeGancho(contexto.gancho, true);
  for (const g of entrega.ganchos) poeGancho(g.texto, false);
  if (ganchos.length > 0) ganchos[0].recomendado = true;

  // O que pode aparecer: possibilidade, nunca previsão; sem número que as fontes não tenham.
  const oQueVaoTeResponder: EntregaDaPesquisa["oQueVaoTeResponder"] = [];
  for (const o of entrega.oQueVaoTeResponder) {
    let objecao = limpar(o.objecao, 240);
    const resposta = limpar(o.resposta, 300);
    if (objecao === "" || resposta === "") continue;
    if (!/^\W*pode aparecer\b/i.test(semAcento(objecao))) objecao = `Pode aparecer: ${objecao.charAt(0).toLowerCase()}${objecao.slice(1)}`;
    if (ehPrevisaoDePublico(objecao) || !confere(objecao) || !confere(resposta)) continue;
    oQueVaoTeResponder.push({ objecao, resposta });
    if (oQueVaoTeResponder.length >= OBJECOES_NO_MAXIMO) break;
  }

  // O "Atenção": a regra primeiro, para o corte nunca a tirar.
  const atencao: string[] = [];
  const poeAtencao = (texto: string, maximo = ATENCAO_FRASE_MAXIMO) => {
    const t = limpar(texto, maximo);
    if (t !== "" && !atencao.some((a) => chave(a) === chave(t))) atencao.push(t);
  };
  if (pesquisa.decisaoDaPremissa === "manter" && pesquisa.avisoDaPremissa) {
    const semPrefixo = pesquisa.avisoDaPremissa.replace(/^O que você escreveu não bate com as fontes:\s*/i, "");
    poeAtencao(textosRoteiro.pesquisa.premissaMantida(aviso(semPrefixo, AVISO_DA_PREMISSA_MAXIMO)), 600);
  }
  const cuidados = new Set<Cuidado>(detectarCuidados([contexto.textoDoRoteiro, ...pesquisa.dados.map((d) => d.texto)].join(" ")));
  if (entrega.cuidado !== "nenhum") cuidados.add(entrega.cuidado);
  for (const c of ["politica", "saude", "preco"] as const) if (cuidados.has(c)) poeAtencao(textosRoteiro.pesquisa.cuidado[c]);
  for (const dado of pesquisa.dados.filter((d) => fontes.includes(d.id))) {
    if (dado.antigo) poeAtencao(textosRoteiro.pesquisa.dadoAntigo(dado.fonteNome, dataPorExtensoDaPagina(dado.dataDaPagina) ?? "mais de um ano"));
    else if (!dado.dataDaPagina) poeAtencao(textosRoteiro.pesquisa.dadoSemData(dado.fonteNome));
  }
  for (const item of entrega.atencao) if (confere(limpar(item, ATENCAO_FRASE_MAXIMO))) poeAtencao(item);

  return { ganchos, oQueVaoTeResponder, fontes, atencao: atencao.slice(0, ATENCAO_NO_MAXIMO) };
}
