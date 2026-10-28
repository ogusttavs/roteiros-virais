/**
 * E61 PR 2 (28/10/2026), os temas do dia por conta: o passo que o job `temas-do-dia` roda DEPOIS dos temas do setor, para cada conta do setor que tem foco confirmado e está em uso.
 *
 * A coleta continua por setor (custo de coleta a mais: zero). Por conta:
 *  1. os candidatos são os vídeos do setor com análise (até 200, o teto da busca por significado), filtrados e ordenados pela proximidade com o FOCO da conta pelo modelo barato
 *     (`escolherComIA`, o mesmo do Tema livre, com o mesmo cache de 14 dias: foco igual sobre os mesmos vídeos não paga de novo);
 *  2. com o que sobrou, o modelo forte escreve até três temas para o foco (mesma tarefa `temasDoDia`, versão 1.10.0), e o CÓDIGO confere a mesma prova de sempre: ids que foram enviados, no mínimo
 *     3 vídeos de 2 contas, maioria brasileira, piso de views do setor, tudo dentro da janela. Tema sem prova é descartado, nunca corrigido;
 *  3. o que o foco não sustentou é completado com os temas do setor, marcados `doSetor`; se o foco não achou nenhum tema com prova, a linha do dia fica vazia e a conta lê exatamente os temas do setor.
 *
 * Custo por conta e dia (modelo barato mais uma ou duas chamadas do forte com a lista já reduzida), registrado em `geracoes_ia` com o `clienteId`. Só gasta para conta em uso (acesso nos últimos dias
 * do setor) e só quando o foco ou o que o setor tinha mudou desde a linha de hoje. Sem chamar a IA nenhuma vez para conta sem foco confirmado.
 *
 * As partes do job do setor que esta usa (`tentarGerar`, `filtrarProva`) chegam por `ferramentas`, para este arquivo não importar o do setor (que o chama).
 */
import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db";
import { clientes, roteiros, temasDia, temasDiaConta, type TemaDoDia } from "@/db/schema";
import * as temasDoDiaIA from "@/ia/prompts/temasDoDia";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { separarMarcasPorAssinatura } from "@/servicos/assinatura-tarefas";
import { escolherComIA, MAXIMO_DE_CANDIDATOS_PARA_IA } from "@/servicos/busca-por-significado";
import { focoConfirmado, focoParaOPrompt } from "@/servicos/foco-da-conta";
import { reguaDoSetor, semDonoComAnalise, subindoHojeComAnalise } from "@/servicos/pesquisa";
import { minimoBrasileirosNaProva, provaDeVideoEhPossivel } from "@/servicos/prova-tema";
import { completarComOSetor, hashDoFoco, hashDosCandidatos, TEMAS_POR_DIA_DA_CONTA } from "@/servicos/temas-da-conta";

/** Quantos vídeos o filtro do foco devolve, no máximo (o modelo julga os mais próximos um a um; é o que o prompt de filtro já faz com o Tema livre). */
const LIMITE_DO_FILTRO = 10;
const DIA_MS = 24 * 60 * 60 * 1000;

/** O que o job do setor empresta a este: gerar com conferência de id (com o sistema estável do setor, o mesmo dos temas do setor, para o cache de prompt valer) e conferir a prova por código. */
export type FerramentasDosTemas = {
  tentarGerar: (dados: { entrada: string; idsValidos: Set<number>; subindoCount: number; clienteId: number; focoHash: string }) => Promise<{ valido: boolean; temas: TemaDoDia[] }>;
  filtrarProva: (temas: TemaDoDia[]) => Promise<{ temasComProva: TemaDoDia[]; barrados: { titulo: string; motivo: string }[] }>;
  /** Há quantos dias, no máximo, sem abrir o aplicativo a conta ainda ganha tema de madrugada (o mesmo critério do setor, agora por conta). */
  diasDeUso: number;
};

export type ResumoDosTemasDasContas = {
  /** Contas com foco confirmado que o passo olhou. */
  contas: number;
  gerados: number;
  /** A linha de hoje já era deste foco e destes candidatos: nada a refazer. */
  semNovidade: number;
  /** O foco não achou tema com prova: a conta lê os temas do setor. */
  semProva: number;
  mantidos: number;
  falhas: number;
  erros: string[];
};

const VAZIO: ResumoDosTemasDasContas = { contas: 0, gerados: 0, semNovidade: 0, semProva: 0, mantidos: 0, falhas: 0, erros: [] };

/**
 * As contas do setor que ganham tema por foco hoje: ativas, com foco CONFIRMADO, com assinatura em dia e em uso. Com `clienteId` (a pessoa acabou de confirmar ou mudar o foco), só essa, sem o critério
 * de uso (ela está no aplicativo agora), mas com o resto.
 */
export async function contasComFocoParaOSetor(nichoId: number, opcoes: { clienteId?: number; diasDeUso: number; agora: Date }): Promise<{ id: number; nome: string; foco: string }[]> {
  const condicoes = [eq(clientes.nichoId, nichoId), eq(clientes.ativo, true)];
  if (opcoes.clienteId !== undefined) condicoes.push(eq(clientes.id, opcoes.clienteId));
  else condicoes.push(gte(clientes.ultimoAcessoEm, new Date(opcoes.agora.getTime() - opcoes.diasDeUso * DIA_MS)));
  const linhas = await db()
    .select({ id: clientes.id, nome: clientes.nome, foco: clientes.foco, focoOrigem: clientes.focoOrigem, focoConfirmadoEm: clientes.focoConfirmadoEm })
    .from(clientes)
    .where(and(...condicoes))
    .orderBy(clientes.id);
  const comFoco = linhas.flatMap((c) => {
    const foco = focoConfirmado(c);
    return foco ? [{ id: c.id, nome: c.nome, foco }] : [];
  });
  if (comFoco.length === 0) return [];
  // A conta sem assinatura que vale não ganha tema por foco: ele gasta (modelo barato e forte por conta).
  const { liberadas } = await separarMarcasPorAssinatura(comFoco.map((c) => c.id), { agora: opcoes.agora });
  return comFoco.filter((c) => liberadas.has(c.id));
}

/**
 * Refazer a linha de hoje só quando faz sentido: se um roteiro de hoje já nasceu de um tema que está lá (e o foco é o mesmo), trocar a lista debaixo dele confundiria quem já escolheu; e a lista nova
 * nunca pode ter menos temas próprios (do foco) do que a que já está gravada.
 */
async function podeSobrescrever(clienteId: number, existente: { temas: TemaDoDia[]; focoHash: string } | undefined, focoHash: string, propriosNovos: number): Promise<boolean> {
  if (!existente || existente.focoHash !== focoHash) return true;
  const propriosAntes = existente.temas.filter((t) => !t.doSetor && !t.doMomento).length;
  if (propriosNovos < propriosAntes) return false;
  const titulos = existente.temas.map((t) => t.titulo);
  if (titulos.length === 0) return true;
  const [jaUsou] = await db()
    .select({ id: roteiros.id })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), eq(roteiros.data, hojeISO()), eq(roteiros.origem, "sugerido"), inArray(roteiros.tema, titulos)))
    .limit(1);
  return !jaUsou;
}

export async function gerarTemasDasContas(dados: {
  nichoId: number;
  /** Só esta conta (a pessoa acabou de confirmar ou mudar o foco). Sem isto, todas as contas com foco do setor que estão em uso. */
  clienteId?: number;
  ferramentas: FerramentasDosTemas;
  agora?: Date;
}): Promise<ResumoDosTemasDasContas> {
  const agora = dados.agora ?? new Date();
  const contas = await contasComFocoParaOSetor(dados.nichoId, { clienteId: dados.clienteId, diasDeUso: dados.ferramentas.diasDeUso, agora });
  if (contas.length === 0) return { ...VAZIO, erros: [] };

  const resumo: ResumoDosTemasDasContas = { ...VAZIO, contas: contas.length, erros: [] };
  const [regua, subindo, semDono, [linhaDoSetor]] = await Promise.all([
    reguaDoSetor(dados.nichoId),
    // Os candidatos do setor: a lista inteira que a busca por significado aguenta (o job do setor manda só 30 ao modelo forte; aqui o modelo barato lê até 200 e devolve os mais próximos do foco).
    subindoHojeComAnalise(dados.nichoId, MAXIMO_DE_CANDIDATOS_PARA_IA, { brasilPrimeiro: true }),
    semDonoComAnalise(dados.nichoId),
    db().select({ temas: temasDia.temas }).from(temasDia).where(and(eq(temasDia.nichoId, dados.nichoId), eq(temasDia.data, hojeISO()))),
  ]);
  const temasDoSetor = linhaDoSetor?.temas ?? [];
  if (subindo.length === 0 && semDono.length === 0) return { ...resumo, semProva: contas.length };

  const candidatosHash = hashDosCandidatos(
    [...subindo.map((v) => v.id), ...semDono.map((v) => -v.id)],
    temasDoSetor.filter((t) => !t.doMomento).map((t) => t.titulo),
  );
  const candidatos = [...subindo, ...semDono].map((v) => ({ id: v.id, assunto: v.assunto, titulo: null }));

  for (const conta of contas) {
    try {
      const foco = focoParaOPrompt(conta.foco);
      const focoHash = hashDoFoco(conta.foco);
      const [existente] = await db()
        .select({ temas: temasDiaConta.temas, focoHash: temasDiaConta.focoHash, candidatosHash: temasDiaConta.candidatosHash })
        .from(temasDiaConta)
        .where(and(eq(temasDiaConta.clienteId, conta.id), eq(temasDiaConta.data, hojeISO())));
      if (existente && existente.focoHash === focoHash && existente.candidatosHash === candidatosHash) {
        resumo.semNovidade += 1;
        continue;
      }

      // 1. O filtro pelo foco: o modelo barato devolve os ids que tratam do assunto da conta, do mais próximo ao menos. `null` é o modelo fora do ar: sem linha hoje (tenta de novo na próxima rodada) e a conta lê o setor.
      const proximos = await escolherComIA({ clienteId: conta.id, tema: foco, setores: [dados.nichoId], candidatos, limite: LIMITE_DO_FILTRO });
      if (proximos === null) {
        resumo.falhas += 1;
        resumo.erros.push(`conta ${conta.id}: o filtro do foco nao respondeu`);
        continue;
      }
      const idsProximos = new Set(proximos);
      const ordem = new Map(proximos.map((id, i) => [id, i]));
      const subindoDoFoco = subindo.filter((v) => ordem.has(v.id)).sort((a, b) => ordem.get(a.id)! - ordem.get(b.id)!);
      const semDonoDoFoco = semDono.filter((v) => ordem.has(v.id)).sort((a, b) => ordem.get(a.id)! - ordem.get(b.id)!);

      // 2. Os temas do foco, só se a prova de vídeo é possível com o que sobrou (sem isso as chamadas seriam gasto à toa: todo tema seria barrado).
      let proprios: TemaDoDia[] = [];
      if (provaDeVideoEhPossivel(subindoDoFoco, semDonoDoFoco.length)) {
        const idsValidos = new Set([...subindoDoFoco.map((v) => v.id), ...semDonoDoFoco.map((v) => v.id)]);
        const entradaBase = {
          subindoHoje: subindoDoFoco,
          semDono: semDonoDoFoco,
          noticias: [],
          minimoBrasilEmTres: minimoBrasileirosNaProva(3, regua.proporcaoBrasil),
          focoDaConta: foco,
        };
        const gerar = (ajuste?: string) =>
          dados.ferramentas.tentarGerar({ entrada: temasDoDiaIA.montarEntrada({ ...entradaBase, ajuste }), idsValidos, subindoCount: idsValidos.size, clienteId: conta.id, focoHash });

        let tentativa = await gerar();
        if (!tentativa.valido) tentativa = await gerar();
        if (tentativa.valido) {
          const primeira = await dados.ferramentas.filtrarProva(tentativa.temas);
          proprios = primeira.temasComProva.slice(0, TEMAS_POR_DIA_DA_CONTA);
          // Uma segunda chance só quando a prova barrou TODOS os temas (o dia da conta ficaria sem nenhum do foco): o modelo recebe o motivo de cada um. Com pelo menos um tema do foco, o resto vem do setor.
          if (proprios.length === 0 && primeira.barrados.length > 0) {
            const ajuste = [
              "Segunda tentativa. Na primeira, estes temas foram descartados por não cumprirem a regra da prova:",
              ...primeira.barrados.map((b) => `- "${b.titulo}": ${b.motivo}.`),
              "Proponha os temas de novo, cada um apoiado num grupo de vídeos da lista que cumpra a regra da prova. Confira conta e origem de cada id antes de citar.",
            ].join("\n");
            const segunda = await gerar(ajuste);
            if (segunda.valido) proprios = (await dados.ferramentas.filtrarProva(segunda.temas)).temasComProva.slice(0, TEMAS_POR_DIA_DA_CONTA);
          }
        }
      }

      // 3. O dia da conta: os temas do foco e, para fechar três, os do setor que ainda são próximos (marcados). Sem nenhum tema do foco, linha vazia: a conta lê o setor, como sempre.
      const temas = completarComOSetor(proprios, temasDoSetor, idsProximos);
      if (!(await podeSobrescrever(conta.id, existente, focoHash, proprios.length))) {
        resumo.mantidos += 1;
        continue;
      }
      await db()
        .insert(temasDiaConta)
        .values({ clienteId: conta.id, data: hojeISO(), temas, focoUsado: foco, focoHash, candidatosHash })
        .onConflictDoUpdate({ target: [temasDiaConta.clienteId, temasDiaConta.data], set: { temas, focoUsado: foco, focoHash, candidatosHash } });
      if (proprios.length > 0) resumo.gerados += 1;
      else resumo.semProva += 1;
    } catch (erro) {
      // Uma conta que falha nunca derruba as outras nem os temas do setor, que já estão gravados.
      resumo.falhas += 1;
      resumo.erros.push(`conta ${conta.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
      logger.warn({ err: erro, clienteId: conta.id }, "nao foi possivel montar os temas do dia da conta");
    }
  }
  return resumo;
}
