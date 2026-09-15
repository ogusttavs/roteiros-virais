/**
 * Job `aprender-cliente` (E27, parte 2, item 2): por evento, não por
 * horário. `reprovarERescrever` (`servicos/roteiro.ts`) enfileira depois de
 * gravar cada reprovação. Lê as reprovações dos últimos 90 dias e as regras
 * de hoje (ativas e desativadas), chama o modelo barato direto (uma chamada
 * por reprovação, centavos; a API de lote só compensa em volume e o
 * cliente espera ver a regra no Briefing em seguida), e substitui o
 * conjunto de regras ativas de origem "reprovacao": a mesma regra que já
 * existia (mesma frase normalizada e mesmo motivo de origem) mantém o id e
 * soma a contagem; uma regra desativada nunca volta sozinha, mesmo que o
 * modelo a proponha de novo; uma regra ativa que não aparece mais na saída
 * é removida (o conjunto é substituído, não acumulado).
 */
import { and, eq, gte, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { aprendizadoCliente, geracoesIA, roteiros } from "@/db/schema";
import * as aprenderClienteIA from "@/ia/prompts/aprenderCliente";
import { gerarComVerificacao } from "@/ia/verificador";

import { ErroColeta } from "./execucoes";

export const DIA_MS = 24 * 60 * 60 * 1000;
export const JANELA_DIAS = 90;
const LIMITE_REGRAS = 10;

/** Minusculas, sem acento, sem pontuacao (mesmo raciocinio de `verificador.ts`, `normalizar`). */
function normalizarFrase(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** A mesma regra e a mesma frase normalizada com o mesmo motivo de origem (compare pelos dois, nunca so pela frase). */
function chaveRegra(regra: string, motivoOrigem: string | null): string {
  return `${normalizarFrase(regra)}|${motivoOrigem ?? ""}`;
}

type ReprovacaoBruta = {
  motivos: string[];
  motivoTexto: string | null;
  gancho: string;
  corpo: string;
  reprovadoEm: Date;
};

/**
 * A janela de 90 dias filtra por `roteiros.reprovadoEm` (segunda rodada do
 * PR #42, item 5: "datas de verdade"), não por `geracoesIA.criadoEm`: uma
 * reprovação de hoje num roteiro antigo tem de contar, e o que importa para
 * "quando o cliente reprovou" é a data da reprovação, não a hora em que a
 * versão original foi gerada.
 */
async function reprovacoesDoCliente(clienteId: number): Promise<ReprovacaoBruta[]> {
  const desde = new Date(Date.now() - JANELA_DIAS * DIA_MS);
  const linhas = await db()
    .select({
      conteudo: roteiros.conteudo,
      reprovadoEm: roteiros.reprovadoEm,
      motivosAvaliacao: geracoesIA.motivosAvaliacao,
      motivoAvaliacao: geracoesIA.motivoAvaliacao,
    })
    .from(roteiros)
    .innerJoin(geracoesIA, eq(geracoesIA.id, roteiros.geracaoId))
    .where(
      and(
        eq(roteiros.clienteId, clienteId),
        isNotNull(roteiros.reprovadoEm),
        eq(geracoesIA.avaliacao, "reprovado"),
        gte(roteiros.reprovadoEm, desde),
      ),
    );

  return linhas.map((l) => ({
    motivos: l.motivosAvaliacao ?? [],
    motivoTexto: l.motivoAvaliacao,
    gancho: l.conteudo.gancho,
    corpo: l.conteudo.corpo,
    // isNotNull(roteiros.reprovadoEm) na consulta garante o nao nulo aqui.
    reprovadoEm: l.reprovadoEm!,
  }));
}

/**
 * Quantas reprovações citam este motivo (item 2 do `PROXIMO.md`: "motivo
 * com uma reprovação só vira regra com contagem 1; a partir de duas,
 * contagem >= 2 é regra firme"). Sem motivo estruturado (regra só do texto
 * livre), a contagem fica em 1: não há como atribuir multiplicidade com
 * segurança sem comparação semântica entre textos livres, fora desta
 * rodada.
 */
function contarPorMotivo(reprovacoes: ReprovacaoBruta[], motivoOrigem: string | null): number {
  if (motivoOrigem === null) return 1;
  return reprovacoes.filter((r) => r.motivos.includes(motivoOrigem)).length || 1;
}

/**
 * `primeiraEm`/`ultimaEm` da regra (item 5): o menor e o maior
 * `reprovadoEm` das reprovações que a sustentam, mesmo filtro por motivo de
 * `contarPorMotivo` (as que citam o motivo; sem motivo, todas da janela).
 */
function datasPorMotivo(reprovacoes: ReprovacaoBruta[], motivoOrigem: string | null): { primeiraEm: Date; ultimaEm: Date } {
  const relevantes = motivoOrigem === null ? reprovacoes : reprovacoes.filter((r) => r.motivos.includes(motivoOrigem));
  const base = relevantes.length > 0 ? relevantes : reprovacoes;
  const tempos = base.map((r) => r.reprovadoEm.getTime());
  return { primeiraEm: new Date(Math.min(...tempos)), ultimaEm: new Date(Math.max(...tempos)) };
}

export async function rodarAprenderCliente(clienteId: number): Promise<Record<string, unknown>> {
  const reprovacoes = await reprovacoesDoCliente(clienteId);
  if (reprovacoes.length === 0) {
    throw new ErroColeta(`cliente ${clienteId} sem reprovacao nos ultimos ${JANELA_DIAS} dias`, false);
  }

  const existentes = await db()
    .select()
    .from(aprendizadoCliente)
    .where(eq(aprendizadoCliente.clienteId, clienteId));
  const ativasExistentes = existentes.filter((r) => r.ativa && r.origem === "reprovacao");
  const desativadas = existentes.filter((r) => !r.ativa);
  const chavesDesativadas = new Set(desativadas.map((r) => chaveRegra(r.regra, r.motivoOrigem)));

  const { dados } = await gerarComVerificacao({
    tarefa: "aprenderCliente",
    nivel: aprenderClienteIA.nivel,
    effort: aprenderClienteIA.esforco,
    versaoPrompt: aprenderClienteIA.versao,
    clienteId,
    schema: aprenderClienteIA.schema,
    sistemaEstavel: aprenderClienteIA.montarSistemaEstavel(),
    generoTexto: "regra",
    entrada: aprenderClienteIA.montarEntrada({
      reprovacoes,
      regrasAtivas: ativasExistentes.map((r) => ({ regra: r.regra, motivoOrigem: r.motivoOrigem })),
      regrasDesativadas: desativadas.map((r) => ({ regra: r.regra, motivoOrigem: r.motivoOrigem })),
    }),
    extrairCampos: (d) => Object.fromEntries(d.regras.map((r, i) => [`regra${i}`, r.regra])),
  });

  /**
   * Lista vazia (segunda rodada do PR #42, item 4): a regra dura 2 do
   * prompt manda devolver isso quando as reprovações não sustentam nada de
   * específico. Termina ok, sem mexer em nenhuma regra ativa: o conjunto só
   * é substituído quando o modelo propõe algo, uma resposta vazia nunca é
   * motivo para apagar o que o cliente já tem.
   */
  if (dados.regras.length === 0) {
    return {
      reprovacoesConsideradas: reprovacoes.length,
      regrasPropostas: 0,
      regrasNovas: 0,
      regrasMantidas: 0,
      regrasRemovidas: 0,
      regrasDesativadasIgnoradas: 0,
      saidaVazia: true,
    };
  }

  const propostas = dados.regras
    .slice(0, LIMITE_REGRAS)
    .filter((p) => !chavesDesativadas.has(chaveRegra(p.regra, p.motivoOrigem)));

  const chaveParaExistente = new Map(ativasExistentes.map((r) => [chaveRegra(r.regra, r.motivoOrigem), r]));
  const chavesMantidas = new Set<string>();

  let regrasNovas = 0;
  let regrasMantidas = 0;

  for (const proposta of propostas) {
    const chave = chaveRegra(proposta.regra, proposta.motivoOrigem);
    const contagem = contarPorMotivo(reprovacoes, proposta.motivoOrigem);
    const { primeiraEm, ultimaEm } = datasPorMotivo(reprovacoes, proposta.motivoOrigem);
    const existente = chaveParaExistente.get(chave);

    if (existente) {
      chavesMantidas.add(chave);
      regrasMantidas += 1;
      await db()
        .update(aprendizadoCliente)
        .set({ contagem, ultimaEm, atualizadoEm: new Date() })
        .where(eq(aprendizadoCliente.id, existente.id));
    } else {
      regrasNovas += 1;
      await db()
        .insert(aprendizadoCliente)
        .values({ clienteId, regra: proposta.regra, motivoOrigem: proposta.motivoOrigem, contagem, primeiraEm, ultimaEm, origem: "reprovacao" });
    }
  }

  const paraRemover = ativasExistentes.filter((r) => !chavesMantidas.has(chaveRegra(r.regra, r.motivoOrigem)));
  for (const regra of paraRemover) {
    await db().delete(aprendizadoCliente).where(eq(aprendizadoCliente.id, regra.id));
  }

  return {
    reprovacoesConsideradas: reprovacoes.length,
    regrasPropostas: dados.regras.length,
    regrasNovas,
    regrasMantidas,
    regrasRemovidas: paraRemover.length,
    regrasDesativadasIgnoradas: dados.regras.length - propostas.length,
  };
}
