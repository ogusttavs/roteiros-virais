/**
 * Os ganchos alternativos do roteiro aberto (melhoria 11 de `pesquisa/lacunas-kits-versus-app.md`, `R-COPY-11`): quando a pessoa toca em "Outros ganchos", uma geração à parte e barata devolve de 3
 * a 5 jeitos de abrir o mesmo vídeo, cada um com o tipo de abertura e a emoção; ela troca o gancho do roteiro com um toque e o escolhido fica gravado (`roteiros.ganchoEscolhido`, e o tipo dele em
 * `roteiros.tipoAbertura`, que é o que a curva já lê por tipo de abertura) para depois dizer qual rendeu. O roteiro principal, o schema e o prompt dele não mudam.
 *
 * Tudo é de uma marca só: cada função recebe o `clienteId` que a Server Action tirou da sessão e confere a posse do roteiro. Pede-se uma vez por roteiro (a lista fica guardada; refazer é "Outro
 * ângulo"). Só vale enquanto o roteiro ainda não foi gravado: depois de gravado ou postado o gancho já é o que foi ao ar.
 */
import { and, count, eq, gte } from "drizzle-orm";

import { promessaEmSaude } from "@/carrossel/regras";
import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { geracoesIA, roteiros, type ConteudoRoteiro, type GanchoAlternativo, type GanchosDoRoteiro, type TipoAbertura } from "@/db/schema";
import { acharFormulasDeMaquina, motivosDasFormulas } from "@/ia/formulas-de-maquina";
import * as ganchosIA from "@/ia/prompts/ganchosAlternativos";
import { montarFontesDosFatos } from "@/ia/prompts/roteiro";
import { gerarComVerificacao } from "@/ia/verificador";
import { verificarConformidadeDoLongo } from "@/ia/verificar-copy-roteiro";
import { reservarEnvioPorTrava } from "@/lib/reserva-de-envio";
import { logger } from "@/lib/log";

import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { clientePorId } from "./clientes";
import { inicioDoDiaEmSaoPaulo } from "./noticias-do-dia";
import { leiturasDoCliente } from "./perfis-analisados";
import { ramoAtualDoCliente } from "./ramos";
import { ramosAlternativosDaMarca } from "./ramos-da-conta";
import { formatarCamadaExclusiva, roteiroPorId, type RoteiroLinha } from "./roteiro";

/** Uma geração por vez por marca; o número não colide com as outras travas (carrossel 6500, edição 5620, publicar 5619). */
export const TRAVA_DOS_GANCHOS_ALTERNATIVOS = 6600;
/** Tentativas de geração por marca por dia (cada pedido gasta uma ou duas): segura quem toca em repetição. */
export const TENTATIVAS_DE_GANCHOS_POR_MARCA_POR_DIA = 30;

export type MotivoDosGanchos =
  | "nao-achou"
  | "sem-gancho"
  | "ja-gravado"
  | "sem-briefing"
  | "limite-do-dia"
  | "ia-fora"
  | "em-andamento"
  | "indisponivel"
  | "escolha-invalida"
  | "sem-alternativas";

/** Erro nomeado; a frase que a pessoa lê vem de `textos/ganchos.ts`, escolhida pelo `motivo` (a Server Action faz isso). */
export class ErroGanchos extends Error {
  constructor(
    mensagem: string,
    readonly motivo: MotivoDosGanchos,
  ) {
    super(mensagem);
    this.name = "ErroGanchos";
  }
}

/** Só o Reels falado curto tem um gancho e um tipo de abertura: Story, sem fala e vídeo longo ficam de fora. */
export function roteiroTemGanchoParaTrocar(roteiro: Pick<RoteiroLinha, "formato" | "estilo" | "duracaoDoVideo" | "conteudo">): boolean {
  return roteiro.formato === "reels" && roteiro.estilo === "falado" && roteiro.duracaoDoVideo === "curto" && roteiro.conteudo.gancho.trim() !== "";
}

function semAcentoEmMinuscula(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O texto como vai para o banco: espaços juntos, sem `<` e `>`, sem quebra de linha, sem travessão (vira vírgula) e no teto de tamanho. */
export function limparGancho(texto: string): string {
  return texto
    .replace(/\s*—\s*/g, ", ")
    .replace(/[<>]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ganchosIA.TAMANHO_MAXIMO_DO_GANCHO);
}

type Contexto = {
  ganchoAtual: string;
  tipoAtual: TipoAbertura | null;
  fontes: string;
  ramoSaude: boolean;
};

/** As fórmulas de texto de máquina (R-COPY-26) por gancho, com o número do gancho no motivo, e os números dos ganchos que têm alguma. */
function formulasDosGanchos(ganchos: GanchoAlternativo[], fontes: string): { motivos: string[]; comFormula: Set<number> } {
  const motivos: string[] = [];
  const comFormula = new Set<number>();
  ganchos.forEach((g, i) => {
    const achados = motivosDasFormulas(acharFormulasDeMaquina({ gancho: g.texto }, { fontes }));
    if (achados.length > 0) comFormula.add(i);
    motivos.push(...achados.map((m) => `gancho ${i + 1}: ${m}`));
  });
  return { motivos, comFormula };
}

/**
 * Tudo o que reprova a lista por código, nas duas tentativas: a quantidade (de 3 a 5), o tamanho, o tipo de abertura (diferente entre si e do original), o gancho igual ao atual ou a outro da lista, a
 * conformidade (preço, grátis, promessa, fato inventado: `R-CONF`) e, em ramo de saúde, a promessa de resultado. As fórmulas de máquina ficam à parte (reprovam na 1a tentativa; na 2a o gancho sai
 * da lista, `semFormulasDeMaquina`).
 */
export function problemasDosGanchos(ganchos: GanchoAlternativo[], contexto: Contexto): string[] {
  const motivos: string[] = [];
  if (ganchos.length < ganchosIA.MINIMO_DE_GANCHOS || ganchos.length > ganchosIA.MAXIMO_DE_GANCHOS) {
    motivos.push(`devolva de ${ganchosIA.MINIMO_DE_GANCHOS} a ${ganchosIA.MAXIMO_DE_GANCHOS} ganchos (vieram ${ganchos.length})`);
  }
  const vistosTipo = new Map<TipoAbertura, number>();
  const vistosTexto = new Map<string, number>();
  const atualNormal = semAcentoEmMinuscula(contexto.ganchoAtual);
  ganchos.forEach((g, i) => {
    const n = i + 1;
    const texto = limparGancho(g.texto);
    if (texto.length < 8) motivos.push(`gancho ${n}: curto demais`);
    if (g.texto.trim().length > ganchosIA.TAMANHO_MAXIMO_DO_GANCHO) motivos.push(`gancho ${n}: comprido demais`);
    if (contexto.tipoAtual && contexto.tipoAtual !== "outro" && g.tipoAbertura === contexto.tipoAtual) {
      motivos.push(`gancho ${n}: o tipo de abertura "${g.tipoAbertura}" é o mesmo do gancho atual, escolha outro tipo`);
    }
    const tipoRepetidoCom = vistosTipo.get(g.tipoAbertura);
    if (tipoRepetidoCom !== undefined) motivos.push(`gancho ${n}: o tipo de abertura "${g.tipoAbertura}" já foi usado no gancho ${tipoRepetidoCom}, cada gancho precisa de um tipo diferente`);
    else vistosTipo.set(g.tipoAbertura, n);
    const normal = semAcentoEmMinuscula(texto);
    if (normal !== "" && normal === atualNormal) motivos.push(`gancho ${n}: é igual ao gancho atual`);
    const textoRepetidoCom = vistosTexto.get(normal);
    if (normal !== "" && textoRepetidoCom !== undefined) motivos.push(`gancho ${n}: é igual ao gancho ${textoRepetidoCom}`);
    else vistosTexto.set(normal, n);
    // R-CONF (preço, serviço grátis, promessa, fato inventado): cada gancho faz o papel do gancho do roteiro.
    motivos.push(...verificarConformidadeDoLongo({ gancho: texto, chamadaFinal: "", capitulos: [], edicao: { textoNaTela: [] } }, { fontes: contexto.fontes, ramoSaude: contexto.ramoSaude }).map((m) => `gancho ${n}: ${m}`));
    if (contexto.ramoSaude) {
      const promessa = promessaEmSaude(texto);
      if (promessa) motivos.push(`gancho ${n}: em saúde o conselho da profissão não deixa prometer resultado, tire "${promessa}"`);
    }
  });
  return motivos;
}

/** Tira da lista os ganchos com fórmula de máquina (o que a 2a tentativa só avisa); o que sobra vai para a pessoa. */
export function semFormulasDeMaquina(ganchos: GanchoAlternativo[], fontes: string): GanchoAlternativo[] {
  const { comFormula } = formulasDosGanchos(ganchos, fontes);
  return ganchos.filter((_, i) => !comFormula.has(i));
}

/** A lista que vai para a tela: texto limpo, no máximo cinco, na ordem do modelo. */
export function ganchosParaGuardar(ganchos: GanchoAlternativo[]): GanchoAlternativo[] {
  return ganchos.slice(0, ganchosIA.MAXIMO_DE_GANCHOS).map((g) => ({ texto: limparGancho(g.texto), tipoAbertura: g.tipoAbertura, emocao: g.emocao }));
}

async function marcaEhDeSaude(clienteId: number, nichoId: number | null): Promise<boolean> {
  const principal = (await ramoAtualDoCliente(nichoId))?.ramoSlug;
  const alternativos = (await ramosAlternativosDaMarca(clienteId)).map((a) => a.ramoSlug);
  return [principal, ...alternativos].some((slug) => ramoPorSlug(slug)?.grupo === "saude");
}

/** O que a tela precisa saber: se o roteiro tem gancho para trocar, o gancho que vale, a lista (se já foi pedida) e qual está valendo. Sem nada que não serialize. */
export type VisaoDosGanchos = {
  podeTrocar: boolean;
  atual: { texto: string; tipoAbertura: TipoAbertura | null };
  alternativas: GanchoAlternativo[] | null;
  /** O índice da lista que vale agora; nulo é o gancho de antes da primeira troca. */
  escolhido: number | null;
  /** O gancho de antes da primeira troca, para a pessoa voltar. */
  original: { texto: string; tipoAbertura: TipoAbertura | null } | null;
  /** "Ver como": a tela só mostra, nenhum botão. */
  verComo: boolean;
  /** O roteiro já foi gravado ou postado: o gancho não troca mais. */
  fechado: boolean;
};

export function visaoDosGanchos(roteiro: RoteiroLinha, verComo: boolean): VisaoDosGanchos | null {
  if (!roteiroTemGanchoParaTrocar(roteiro)) return null;
  const guardados = roteiro.ganchosAlternativos;
  return {
    podeTrocar: true,
    atual: { texto: roteiro.conteudo.gancho, tipoAbertura: roteiro.tipoAbertura ?? null },
    alternativas: guardados ? guardados.alternativas : null,
    escolhido: guardados ? guardados.escolhido : null,
    original: guardados ? guardados.original : null,
    verComo,
    fechado: roteiro.status !== "gerado",
  };
}

/**
 * Pede de 3 a 5 ganchos alternativos para o roteiro (modelo barato, uma ou duas tentativas, cada uma em `geracoes_ia`) e os guarda. Se a lista já existe, devolve a guardada sem gastar nada.
 * Quem chama (a Server Action) já conferiu a sessão, o "ver como" e a assinatura.
 */
export async function pedirGanchosAlternativos(clienteId: number, roteiroId: number, agora: Date = new Date()): Promise<VisaoDosGanchos> {
  const reserva = await reservarEnvioPorTrava(TRAVA_DOS_GANCHOS_ALTERNATIVOS, clienteId, "ganchos alternativos");
  if (reserva === "ocupada") throw new ErroGanchos("ja ha ganchos sendo escritos para esta marca", "em-andamento");
  if (reserva === "indisponivel") throw new ErroGanchos("conexoes ocupadas", "indisponivel");
  try {
    return await pedirSemTrava(clienteId, roteiroId, agora);
  } finally {
    await reserva.soltar();
  }
}

async function pedirSemTrava(clienteId: number, roteiroId: number, agora: Date): Promise<VisaoDosGanchos> {
  const roteiro = await roteiroPorId(roteiroId, clienteId);
  if (!roteiro) throw new ErroGanchos("roteiro nao encontrado para esta marca", "nao-achou");
  const visao = visaoDosGanchos(roteiro, false);
  if (!visao) throw new ErroGanchos("este roteiro nao tem gancho para trocar", "sem-gancho");
  if (roteiro.status !== "gerado") throw new ErroGanchos("o roteiro ja foi gravado", "ja-gravado");
  // Já pedida: devolve a lista guardada (lida de novo dentro da trava, para dois toques juntos não pagarem duas vezes).
  if (visao.alternativas && visao.alternativas.length > 0) return visao;

  const cliente = await clientePorId(clienteId);
  if (!cliente) throw new ErroGanchos("marca nao encontrada", "nao-achou");
  const perfil = await perfilDoCliente(clienteId);
  if (!perfil) throw new ErroGanchos("sem briefing compilado", "sem-briefing");

  const [tentativas] = await db()
    .select({ total: count() })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "ganchosAlternativos"), eq(geracoesIA.clienteId, clienteId), gte(geracoesIA.criadoEm, inicioDoDiaEmSaoPaulo(agora))));
  if ((tentativas?.total ?? 0) >= TENTATIVAS_DE_GANCHOS_POR_MARCA_POR_DIA) throw new ErroGanchos("teto diario de ganchos da marca", "limite-do-dia");

  const ramoSaude = await marcaEhDeSaude(clienteId, cliente.nichoId);
  const leituras = await leiturasDoCliente(clienteId);
  const perfilCompilado = formatarPerfilCompilado(perfil);
  const camadaExclusiva = formatarCamadaExclusiva(
    cliente,
    leituras.filter((l) => l.existeNaRede && l.leitura).map((l) => ({ handle: l.handle, leitura: l.leitura as string })),
  );
  const corpo: ConteudoRoteiro = roteiro.conteudo;
  const fontes = `${montarFontesDosFatos({ perfilCompilado, camadaExclusiva, tema: roteiro.tema, objetivoDoVideo: roteiro.objetivoDoVideo })}\nO roteiro (o que o vídeo diz): ${corpo.gancho} ${corpo.corpo} ${corpo.fechamento} ${corpo.chamadaFinal}`;
  const contexto: Contexto = { ganchoAtual: corpo.gancho, tipoAtual: roteiro.tipoAbertura ?? null, fontes, ramoSaude };

  let saida;
  try {
    ({ dados: saida } = await gerarComVerificacao({
      tarefa: "ganchosAlternativos",
      nivel: ganchosIA.nivel,
      effort: ganchosIA.esforco,
      versaoPrompt: ganchosIA.versao,
      clienteId,
      schema: ganchosIA.schema,
      sistemaEstavel: ganchosIA.montarSistemaEstavel({ perfilCompilado, camadaExclusiva, tipo: cliente.tipo, persona: cliente.persona, quemAparece: cliente.quemGrava ?? undefined, ramoSaude }),
      entrada: ganchosIA.montarEntrada({
        tema: roteiro.tema,
        objetivo: roteiro.objetivo,
        ganchoAtual: corpo.gancho,
        tipoAberturaAtual: roteiro.tipoAbertura ?? null,
        corpo: corpo.corpo,
        fechamento: corpo.fechamento,
        chamadaFinal: corpo.chamadaFinal,
      }),
      fontesDosFatos: fontes,
      conferirNumerosNasFontes: true,
      lembreteFinal: ganchosIA.LEMBRETE_ACENTUACAO,
      proibicoes: perfil.fatos.proibicoes,
      citarProibicaoVale: roteiro.origem === "livre",
      exigeEvidencia: false,
      evidenciasFornecidas: [],
      generoTexto: "roteiro",
      maxTokens: 1500,
      extrairEvidencias: () => [],
      extrairCampos: (d) => Object.fromEntries(d.ganchos.map((g, i) => [`gancho ${i + 1}`, g.texto])),
      // R-COPY-26 (texto com cara de máquina): reprova na 1a tentativa; na 2a o gancho com fórmula sai da lista (abaixo), nunca vai para a pessoa.
      verificarExtra: (d, tentativa) => [...problemasDosGanchos(d.ganchos, contexto), ...(tentativa === 1 ? formulasDosGanchos(d.ganchos, fontes).motivos : [])],
    }));
  } catch (erro) {
    if (erro instanceof ErroGanchos) throw erro;
    // A IA que não respondeu ou reprovou duas vezes: a tela diz que não deu e o roteiro segue como está.
    logger.warn({ err: erro, clienteId, roteiroId }, "ganchos alternativos: a geracao nao saiu");
    throw new ErroGanchos("a IA nao entregou ganchos validos", "ia-fora");
  }

  const lista = ganchosParaGuardar(semFormulasDeMaquina(saida.ganchos, fontes));
  if (lista.length < ganchosIA.MINIMO_DE_GANCHOS) throw new ErroGanchos("sobraram menos de tres ganchos depois de tirar os de texto de maquina", "ia-fora");

  const guardados: GanchosDoRoteiro = {
    original: { texto: corpo.gancho, tipoAbertura: roteiro.tipoAbertura ?? null },
    alternativas: lista,
    escolhido: null,
    geradoEm: agora.toISOString(),
    geracaoId: null,
  };
  // Só grava se a lista ainda não existe e o roteiro continua sem gravar (a condição vai no WHERE, não numa leitura de antes).
  const gravadas = await db()
    .update(roteiros)
    .set({ ganchosAlternativos: guardados })
    .where(and(eq(roteiros.id, roteiroId), eq(roteiros.clienteId, clienteId), eq(roteiros.status, "gerado")))
    .returning({ id: roteiros.id });
  if (gravadas.length === 0) throw new ErroGanchos("o roteiro mudou enquanto os ganchos eram escritos", "ja-gravado");
  const atualizado = await roteiroPorId(roteiroId, clienteId);
  const visaoFinal = atualizado ? visaoDosGanchos(atualizado, false) : null;
  if (!visaoFinal) throw new ErroGanchos("roteiro nao encontrado para esta marca", "nao-achou");
  return visaoFinal;
}

/**
 * Troca o gancho do roteiro por um da lista (`indice`) ou volta ao de antes (`"original"`), com um toque. Grava o texto no roteiro, o tipo de abertura dele e o que foi escolhido. Só marca da sessão
 * e só enquanto o roteiro está "gerado". As marcas de fala se apagam (valem para o texto de que saíram).
 */
export async function trocarGancho(clienteId: number, roteiroId: number, escolha: number | "original", agora: Date = new Date()): Promise<VisaoDosGanchos> {
  const roteiro = await roteiroPorId(roteiroId, clienteId);
  if (!roteiro) throw new ErroGanchos("roteiro nao encontrado para esta marca", "nao-achou");
  if (!roteiroTemGanchoParaTrocar(roteiro)) throw new ErroGanchos("este roteiro nao tem gancho para trocar", "sem-gancho");
  if (roteiro.status !== "gerado") throw new ErroGanchos("o roteiro ja foi gravado", "ja-gravado");
  const guardados = roteiro.ganchosAlternativos;
  if (!guardados || guardados.alternativas.length === 0) throw new ErroGanchos("os ganchos ainda nao foram pedidos", "sem-alternativas");
  if (escolha !== "original" && (!Number.isInteger(escolha) || escolha < 0 || escolha >= guardados.alternativas.length)) throw new ErroGanchos("escolha fora da lista", "escolha-invalida");

  // Antes da primeira troca o gancho que vale é o do roteiro (a pessoa pode tê-lo editado depois do pedido): ele passa a ser o "original" para onde dá para voltar.
  const original = guardados.escolhido === null ? { texto: roteiro.conteudo.gancho, tipoAbertura: roteiro.tipoAbertura ?? null } : guardados.original;
  const novoTexto = escolha === "original" ? original.texto : guardados.alternativas[escolha].texto;
  const novoTipo = escolha === "original" ? original.tipoAbertura : guardados.alternativas[escolha].tipoAbertura;

  const conteudo: ConteudoRoteiro = { ...roteiro.conteudo, gancho: novoTexto };
  // E54 (parte 2): o primeiro gancho da entrega da pesquisa é o do próprio roteiro; trocou, a lista passa a mostrar o novo como o recomendado (mesma conta da edição à mão).
  const entrega = roteiro.conteudo.entregaDaPesquisa;
  if (entrega && entrega.ganchos.length > 0 && novoTexto.trim() !== "" && novoTexto.trim() !== roteiro.conteudo.gancho.trim()) {
    conteudo.entregaDaPesquisa = {
      ...entrega,
      ganchos: [{ texto: novoTexto.slice(0, 300), recomendado: true }, ...entrega.ganchos.slice(1).filter((g) => g.texto.trim() !== novoTexto.trim()).map((g) => ({ ...g, recomendado: false }))],
    };
  }
  const falaMudou = novoTexto.trim() !== roteiro.conteudo.gancho.trim();
  const novos: GanchosDoRoteiro = { ...guardados, original, escolhido: escolha === "original" ? null : escolha };

  const gravadas = await db()
    .update(roteiros)
    .set({
      conteudo,
      tipoAbertura: novoTipo,
      ganchosAlternativos: novos,
      ganchoEscolhido: escolha === "original" ? "original" : "alternativo",
      ganchoEscolhidoEm: agora,
      ...(falaMudou ? { marcasDeFala: null } : {}),
    })
    .where(and(eq(roteiros.id, roteiroId), eq(roteiros.clienteId, clienteId), eq(roteiros.status, "gerado")))
    .returning({ id: roteiros.id });
  if (gravadas.length === 0) throw new ErroGanchos("o roteiro mudou antes da troca", "ja-gravado");
  const atualizado = await roteiroPorId(roteiroId, clienteId);
  const visao = atualizado ? visaoDosGanchos(atualizado, false) : null;
  if (!visao) throw new ErroGanchos("roteiro nao encontrado para esta marca", "nao-achou");
  return visao;
}
