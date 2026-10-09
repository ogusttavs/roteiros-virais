/**
 * O tema "do momento" (E55): um dos três temas do dia do setor vira o assunto que está em alta no Brasil, adaptado ao setor, quando algum assunto da lista de agora (`tendencias_brasil`) cabe
 * no setor acima de um mínimo. É para o MESMO DIA (decisão do Gustavo em 06/10/2026: "não adianta pegar uma tendência e fazer daqui a uma semana"):
 * - só vale enquanto o assunto continua na lista de agora; quando sai (a coleta roda de madrugada e ao meio-dia), o tema some do Hoje e do Criar (`temasQueAindaValem`, aplicado onde os temas
 *   são lidos, e aqui, onde o tema é tirado da linha do dia);
 * - assunto sensível (tragédia, morte, política partidária) nunca vira tema sozinho;
 * - o tema é do SETOR (compartilhado pelas marcas dele, como os três do dia), então o modelo só vê o setor e o modelo do nicho, nunca o perfil de uma marca;
 * - ocupa a terceira vaga: com três temas, troca o último que ninguém usou hoje (nunca um que já virou roteiro); com menos de três, entra no fim.
 * Uma chamada ao modelo forte por setor e por rodada de tendências, no máximo (`tendencias_avaliadas` guarda a rodada já avaliada, com tema ou sem encaixe).
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { clientes, nichos, roteiros, temasDia, tendenciasAvaliadas, type TemaDoDia } from "@/db/schema";
import * as temaDoMomentoIA from "@/ia/prompts/temaDoMomento";
import { gerarComVerificacao } from "@/ia/verificador";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { formatarModeloNicho, modeloNichoAtual } from "@/servicos/pesquisa";
import { listaDeTendenciasDeAgora, temasQueAindaValem } from "@/servicos/tendencias";

import { setoresEmUso } from "./temas-do-dia";

/** Quantos assuntos (do mais alto para baixo, sem os sensíveis) o modelo vê. */
const MAXIMO_DE_ASSUNTOS_PARA_O_MODELO = 12;
const TEMAS_POR_DIA = 3;

export type ResultadoTemaDoMomento = "mantido" | "removido" | "criado" | "sem_lista" | "ja_avaliado" | "sem_assunto" | "sem_encaixe" | "sem_vaga" | "falhou";

type NichoDoMomento = { id: number; nome: string; termos: string[] };

async function gravarTemas(nichoId: number, temas: TemaDoDia[]): Promise<void> {
  await db()
    .insert(temasDia)
    .values({ nichoId, data: hojeISO(), temas })
    .onConflictDoUpdate({ target: [temasDia.nichoId, temasDia.data], set: { temas } });
}

async function marcarAvaliada(nichoId: number, rodadaEm: Date, resultado: "tema" | "sem_encaixe" | "sem_assunto"): Promise<void> {
  await db().insert(tendenciasAvaliadas).values({ nichoId, rodadaEm, resultado }).onConflictDoNothing();
}

/** O índice do tema que o do momento pode trocar: o último que nenhum roteiro de hoje do setor usou. Nulo se todos já foram usados. */
async function indiceDaVaga(nichoId: number, temas: TemaDoDia[]): Promise<number | null> {
  const titulos = temas.map((t) => t.titulo);
  const usados = new Set(
    (
      await db()
        .select({ tema: roteiros.tema })
        .from(roteiros)
        .innerJoin(clientes, eq(clientes.id, roteiros.clienteId))
        .where(and(eq(clientes.nichoId, nichoId), eq(roteiros.data, hojeISO()), eq(roteiros.origem, "sugerido"), inArray(roteiros.tema, titulos)))
    ).map((l) => l.tema),
  );
  for (let i = temas.length - 1; i >= 0; i -= 1) if (!usados.has(temas[i].titulo)) return i;
  return null;
}

/**
 * Atualiza o tema do momento de um setor: tira o que não vale mais (o assunto saiu da lista), e, sem um tema do momento, tenta criar um (uma vez por rodada de tendências). Devolve o que aconteceu.
 */
export async function atualizarTemaDoMomento(nicho: NichoDoMomento, agora: Date = new Date()): Promise<ResultadoTemaDoMomento> {
  const lista = await listaDeTendenciasDeAgora(agora);
  const [linha] = await db().select({ temas: temasDia.temas }).from(temasDia).where(and(eq(temasDia.nichoId, nicho.id), eq(temasDia.data, hojeISO())));
  const temas = linha?.temas ?? [];

  const vigentes = temasQueAindaValem(temas, lista);
  const removeu = vigentes.length !== temas.length;
  if (removeu && linha) await gravarTemas(nicho.id, vigentes);
  if (vigentes.some((t) => t.doMomento)) return "mantido";

  if (!lista) return removeu ? "removido" : "sem_lista";

  const [jaAvaliada] = await db().select({ id: tendenciasAvaliadas.id }).from(tendenciasAvaliadas).where(and(eq(tendenciasAvaliadas.nichoId, nicho.id), eq(tendenciasAvaliadas.rodadaEm, lista.coletadaEm)));
  if (jaAvaliada) return removeu ? "removido" : "ja_avaliado";

  const candidatos = lista.assuntos.filter((a) => !a.sensivel).slice(0, MAXIMO_DE_ASSUNTOS_PARA_O_MODELO);
  if (candidatos.length === 0) {
    await marcarAvaliada(nicho.id, lista.coletadaEm, "sem_assunto");
    return "sem_assunto";
  }

  let vaga: number | null = null;
  if (vigentes.length >= TEMAS_POR_DIA) {
    vaga = await indiceDaVaga(nicho.id, vigentes);
    if (vaga === null) return "sem_vaga";
  }

  const modeloNicho = await modeloNichoAtual(nicho.id);
  const assuntosParaOModelo = candidatos.map((a, i) => ({ numero: i + 1, assunto: a.assunto, sensivel: a.sensivel, fontes: a.fontes.map((f) => ({ fonte: f.fonte, titulo: f.titulo })) }));

  let escolha: temaDoMomentoIA.SaidaTemaDoMomento["escolha"];
  try {
    const { dados } = await gerarComVerificacao({
      tarefa: "temaDoMomento",
      nivel: temaDoMomentoIA.nivel,
      effort: temaDoMomentoIA.esforco,
      versaoPrompt: temaDoMomentoIA.versao,
      schema: temaDoMomentoIA.schema,
      sistemaEstavel: temaDoMomentoIA.montarSistemaEstavel({ nomeDoSetor: nicho.nome, termosDoSetor: nicho.termos, modeloNicho: formatarModeloNicho(modeloNicho?.modelo ?? null) }),
      entrada: temaDoMomentoIA.montarEntrada({ assuntos: assuntosParaOModelo }),
      exigeEvidencia: false,
      evidenciasFornecidas: [],
      generoTexto: "tema",
      extrairCampos: (d): Record<string, string> => (d.escolha ? { titulo: d.escolha.titulo, descricao: d.escolha.descricao, porQue: d.escolha.porQue } : {}),
    });
    escolha = dados.escolha;
  } catch (erro) {
    logger.warn({ err: erro, nichoId: nicho.id }, "nao foi possivel escrever o tema do momento");
    return "falhou";
  }

  const escolhido = escolha ? candidatos[escolha.indice - 1] : undefined;
  if (!escolha || !escolhido || escolha.encaixe < temaDoMomentoIA.ENCAIXE_MINIMO) {
    await marcarAvaliada(nicho.id, lista.coletadaEm, "sem_encaixe");
    return removeu ? "removido" : "sem_encaixe";
  }

  const fonteCitada = escolhido.fontes[0];
  const tema: TemaDoDia = {
    titulo: escolha.titulo.trim(),
    descricao: escolha.descricao.trim(),
    porQue: escolha.porQue.trim(),
    evidencias: [],
    evidenciasNoticias: [],
    puxaPara: escolha.puxaPara,
    doMomento: {
      chave: escolhido.chave,
      assunto: escolhido.assunto,
      termos: escolhido.termos,
      fonte: fonteCitada?.fonte === "youtube" ? "Em alta no YouTube no Brasil" : "Em alta no Google no Brasil",
      url: fonteCitada?.url ?? null,
      coletadaEm: lista.coletadaEm.toISOString(),
      encaixe: escolha.encaixe,
    },
  };

  const novos = vaga === null ? [...vigentes, tema] : vigentes.map((t, i) => (i === vaga ? tema : t));
  await gravarTemas(nicho.id, novos);
  await marcarAvaliada(nicho.id, lista.coletadaEm, "tema");
  return "criado";
}

/** Depois de cada coleta de tendências: o tema do momento de todo setor em uso (o mesmo critério dos temas da madrugada, `setoresEmUso`). */
export async function atualizarTemasDoMomentoDosSetoresEmUso(agora: Date = new Date()): Promise<Record<string, unknown>> {
  const emUso = await setoresEmUso(agora);
  if (emUso.size === 0) return { setores: 0 };
  const lista = await db().select({ id: nichos.id, nome: nichos.nome, termos: nichos.termos }).from(nichos).where(and(eq(nichos.ativo, true), inArray(nichos.id, [...emUso])));
  const contagem: Record<string, number> = {};
  const erros: string[] = [];
  for (const nicho of lista) {
    try {
      const resultado = await atualizarTemaDoMomento(nicho, agora);
      contagem[resultado] = (contagem[resultado] ?? 0) + 1;
    } catch (erro) {
      erros.push(`setor ${nicho.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return { setores: lista.length, ...contagem, erros: erros.length > 0 ? erros : undefined };
}
