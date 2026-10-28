/**
 * E61 PR 1, "o foco da conta" (28/10/2026): dentro do setor, cada conta fala de um assunto e para um público. A pesquisa continua por setor; o foco é o que a conta diz de si ("marketing e
 * automação com IA, para donos de pequena empresa"). Três estados, todos nas colunas `clientes.foco*` (ver o comentário no schema):
 *
 *  - sem foco: `foco` nulo. Tudo como era antes desta etapa.
 *  - sugerido: a IA propôs (`sugerirFoco`) e a pessoa ainda não respondeu. Aparece na tela; NUNCA chega ao roteiro.
 *  - confirmado: a pessoa disse "Está certo" (`confirmarFoco`) ou escreveu o foco ela mesma (`escreverFoco`). Só este chega ao roteiro (`focoConfirmado`).
 *
 * Tudo é de uma conta só: cada função recebe o `clienteId` que a Server Action tirou da sessão e escreve com `WHERE id = clienteId`. Nada daqui lê a conta de outra pessoa.
 */
import { and, count, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/db";
import { clientes, geracoesIA, nichos, type Cliente, type OrigemDoFoco } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import * as sugerirIA from "@/ia/prompts/sugerirFoco";
import { registrarGeracao } from "@/ia/registro";
import { logger } from "@/lib/log";
import { comArroba } from "@/lib/perfil-redes";
import { encontrarJargaoDoMotor, encontrarProblemas } from "@/lib/regras-de-texto";

import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { clientePorId } from "./clientes";
import { limparParaPrompt } from "./noticias-assuntos";
import { inicioDoDiaEmSaoPaulo } from "./noticias-do-dia";

export const TAMANHO_MAXIMO_DO_FOCO = sugerirIA.TAMANHO_MAXIMO_DO_FOCO;
export const TAMANHO_MINIMO_DO_FOCO = sugerirIA.TAMANHO_MINIMO_DO_FOCO;
/** Quantos pedidos de sugestão uma conta faz por dia: segura quem aperta o botão em repetição (cada um custa uma fração de centavo). */
export const PEDIDOS_DE_FOCO_POR_CONTA_POR_DIA = 10;

/** Erro nomeado; a frase que a pessoa lê vem de `textosBriefing.focoDaConta`, escolhida pelo `motivo` (a Server Action faz isso). */
export class ErroFoco extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "texto_curto" | "texto_longo" | "limite_do_dia" | "sem_base" | "ia_fora" | "ja_confirmado",
  ) {
    super(mensagem);
    this.name = "ErroFoco";
  }
}

export type EstadoDoFoco =
  | { estado: "sem" }
  | { estado: "sugerido"; texto: string }
  | { estado: "confirmado"; texto: string; origem: OrigemDoFoco; confirmadoEm: Date };

type CamposDoFoco = Pick<Cliente, "foco" | "focoOrigem" | "focoConfirmadoEm">;

/** O estado do foco de uma conta, pelas três colunas. Foco vazio ou só com espaços vale como "sem". */
export function estadoDoFoco(cliente: CamposDoFoco): EstadoDoFoco {
  const texto = (cliente.foco ?? "").trim();
  if (texto === "") return { estado: "sem" };
  if (!cliente.focoConfirmadoEm) return { estado: "sugerido", texto };
  return { estado: "confirmado", texto, origem: cliente.focoOrigem ?? "escrito", confirmadoEm: cliente.focoConfirmadoEm };
}

/** O estado do foco como a tela o recebe: só texto e origem (sem data), para atravessar a fronteira do servidor sem nada que não serialize. */
export type FocoParaATela = { estado: "sem" } | { estado: "sugerido"; texto: string } | { estado: "confirmado"; texto: string; origem: OrigemDoFoco };

export function focoParaATela(cliente: CamposDoFoco): FocoParaATela {
  const estado = estadoDoFoco(cliente);
  if (estado.estado === "confirmado") return { estado: "confirmado", texto: estado.texto, origem: estado.origem };
  return estado;
}

/** O foco que o roteiro pode usar: só o confirmado pela pessoa. Uma sugestão sem resposta é `null`. */
export function focoConfirmado(cliente: Partial<CamposDoFoco>): string | null {
  const estado = estadoDoFoco({ foco: cliente.foco ?? null, focoOrigem: cliente.focoOrigem ?? null, focoConfirmadoEm: cliente.focoConfirmadoEm ?? null });
  return estado.estado === "confirmado" ? estado.texto : null;
}

/** O texto como vai para o banco: espaços juntos, sem `<` e `>` (entra no prompt como dado), sem travessão (vira vírgula), sem quebra de linha. */
export function limparFoco(texto: string): string {
  return texto
    .replace(/\s*—\s*/g, ", ")
    .replace(/[<>]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O que reprova uma sugestão da IA antes de ela chegar na tela: curta, comprida, emoji, travessão que sobrou, jargão do produto ou do motor. O texto que a PESSOA escreve não passa por aqui
 * (são as palavras dela; só o tamanho vale).
 */
export function problemasDaSugestao(texto: string): string[] {
  const motivos: string[] = [];
  if (texto.length < TAMANHO_MINIMO_DO_FOCO) motivos.push("curto demais");
  if (texto.length > TAMANHO_MAXIMO_DO_FOCO) motivos.push("comprido demais");
  motivos.push(...encontrarProblemas(texto), ...encontrarJargaoDoMotor(texto));
  return motivos;
}

/** Os @ das redes da própria conta, para a entrada da sugestão. */
function perfisDaConta(cliente: Pick<Cliente, "perfis">): string[] {
  const p = cliente.perfis;
  return [p?.instagram, p?.tiktok, p?.youtube].filter((v): v is string => typeof v === "string" && v.trim() !== "").map(comArroba);
}

/**
 * Pede ao modelo barato uma sugestão de foco, a partir do que a conta já tem, e a guarda como "sugerido" (nunca confirmado). Não faz nada quando a pessoa já confirmou um foco (`ja_confirmado`);
 * sem briefing compilado não há do que partir (`sem_base`). Cada tentativa vai para `geracoes_ia`. Quem chama (a Server Action) já conferiu a sessão, o "ver como" e a assinatura.
 */
export async function sugerirFoco(clienteId: number, agora: Date = new Date()): Promise<string> {
  const cliente = await clientePorId(clienteId);
  if (!cliente) throw new ErroFoco("conta nao encontrada", "sem_base");
  const atual = estadoDoFoco(cliente);
  if (atual.estado === "confirmado") throw new ErroFoco("a conta ja tem um foco confirmado", "ja_confirmado");

  const perfil = await perfilDoCliente(clienteId);
  if (!perfil) throw new ErroFoco("sem briefing compilado para partir", "sem_base");

  const [pedidos] = await db()
    .select({ total: count() })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "sugerirFoco"), eq(geracoesIA.clienteId, clienteId), gte(geracoesIA.criadoEm, inicioDoDiaEmSaoPaulo(agora))));
  if ((pedidos?.total ?? 0) >= PEDIDOS_DE_FOCO_POR_CONTA_POR_DIA) throw new ErroFoco("teto diario de pedidos de foco da conta", "limite_do_dia");

  let ramo: string | null = cliente.ramoOutro?.trim() || null;
  if (cliente.nichoId) {
    const [nicho] = await db().select({ nome: nichos.nome }).from(nichos).where(eq(nichos.id, cliente.nichoId));
    ramo = nicho?.nome ?? ramo;
  }

  const entradaBase = sugerirIA.montarEntrada({
    nomeDaMarca: cliente.nome,
    tipo: cliente.tipo,
    ramo,
    perfilCompilado: formatarPerfilCompilado(perfil),
    perfisCitados: [...cliente.camadaExclusiva.concorrentes, ...cliente.camadaExclusiva.perfisAdmirados],
    perfisDaConta: perfisDaConta(cliente),
    focoAnterior: atual.estado === "sugerido" ? atual.texto : null,
  });

  let foco: string | null = null;
  let motivos: string[] = [];
  for (let tentativa = 1; tentativa <= 2 && foco === null; tentativa++) {
    const entrada = tentativa === 1 ? entradaBase : `${entradaBase}\n\nA tentativa anterior foi reprovada. Motivo: ${motivos.join("; ")}. Corrija isso.`;
    const inicio = Date.now();
    let saida;
    try {
      saida = await gerarEstruturado({
        tarefa: "sugerirFoco",
        nivel: sugerirIA.nivel,
        effort: sugerirIA.esforco,
        schema: sugerirIA.schema,
        sistemaEstavel: sugerirIA.montarSistemaEstavel(),
        entrada,
        maxTokens: 400,
      });
    } catch (erro) {
      if (erro instanceof ErroIA) throw new ErroFoco("a IA nao respondeu", "ia_fora");
      throw erro;
    }

    const candidato = limparFoco(saida.dados.foco);
    motivos = problemasDaSugestao(candidato);

    // O registro é do custo e da auditoria: se ele falhar, a sugestão que já foi paga não se perde.
    try {
      await registrarGeracao({
        tarefa: "sugerirFoco",
        versaoPrompt: sugerirIA.versao,
        modelo: saida.modelo,
        nivel: sugerirIA.nivel,
        clienteId,
        entradas: { entrada, tentativa },
        saida: { ...saida.dados, reprovadoPor: motivos },
        uso: { tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida, tokensCacheLeitura: saida.tokensCacheLeitura, tokensCacheEscrita: saida.tokensCacheEscrita },
        duracaoMs: Date.now() - inicio,
      });
    } catch (erro) {
      logger.error({ err: erro, clienteId }, "nao registrou a geracao da sugestao de foco");
    }

    if (motivos.length === 0) foco = candidato;
  }
  if (foco === null) throw new ErroFoco(`sugestao reprovada duas vezes: ${motivos.join("; ")}`, "ia_fora");

  // Só grava se a pessoa não confirmou outro foco enquanto o modelo pensava (a condição vai no WHERE, não numa leitura de antes).
  const gravadas = await db()
    .update(clientes)
    .set({ foco, focoOrigem: "sugerido", focoConfirmadoEm: null })
    .where(and(eq(clientes.id, clienteId), isNull(clientes.focoConfirmadoEm)))
    .returning({ id: clientes.id });
  if (gravadas.length === 0) throw new ErroFoco("a conta confirmou um foco enquanto a sugestao era feita", "ja_confirmado");
  return foco;
}

/**
 * "Está certo" na sugestão: confirma exatamente o texto que a pessoa está vendo. Devolve "mudou" quando a sugestão já é outra (ela apertou "Sugerir outro" em outra aba) ou deixou de existir;
 * a tela então busca o estado de novo em vez de confirmar um texto que ela não leu.
 */
export async function confirmarFoco(clienteId: number, textoVisto: string, agora: Date = new Date()): Promise<"confirmado" | "mudou"> {
  const visto = limparFoco(textoVisto);
  const gravadas = await db()
    .update(clientes)
    .set({ focoConfirmadoEm: agora })
    .where(and(eq(clientes.id, clienteId), eq(clientes.foco, visto), isNull(clientes.focoConfirmadoEm)))
    .returning({ id: clientes.id });
  if (gravadas.length > 0) return "confirmado";
  // Já confirmado com este mesmo texto (duplo toque): o resultado que a pessoa queria já existe.
  const cliente = await clientePorId(clienteId);
  const estado = cliente ? estadoDoFoco(cliente) : { estado: "sem" as const };
  return estado.estado === "confirmado" && estado.texto === visto ? "confirmado" : "mudou";
}

/** O foco que a pessoa escreveu ou corrigiu: fica confirmado na hora, com origem "escrito". Texto vazio tira o foco (a conta volta a ser como antes). */
export async function escreverFoco(clienteId: number, texto: string, agora: Date = new Date()): Promise<void> {
  const limpo = limparFoco(texto);
  if (limpo === "") {
    await tirarFoco(clienteId);
    return;
  }
  if (limpo.length < TAMANHO_MINIMO_DO_FOCO) throw new ErroFoco("foco curto demais", "texto_curto");
  if (limpo.length > TAMANHO_MAXIMO_DO_FOCO) throw new ErroFoco("foco comprido demais", "texto_longo");
  await db().update(clientes).set({ foco: limpo, focoOrigem: "escrito", focoConfirmadoEm: agora }).where(eq(clientes.id, clienteId));
}

/** Tira o foco (confirmado ou sugerido): a conta volta a ser como antes. */
export async function tirarFoco(clienteId: number): Promise<void> {
  await db().update(clientes).set({ foco: null, focoOrigem: null, focoConfirmadoEm: null }).where(eq(clientes.id, clienteId));
}

/** O foco como o roteiro o escreve na camada exclusiva (o texto da pessoa, limpo e curto). */
export function focoParaOPrompt(foco: string): string {
  return limparParaPrompt(foco, TAMANHO_MAXIMO_DO_FOCO);
}
