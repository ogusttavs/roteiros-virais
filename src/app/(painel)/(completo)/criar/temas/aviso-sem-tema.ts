import { horaMinutoAtualISO } from "@/lib/config";
import type { ResultadoTemasHoje } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";

/** H3, item 1: o aviso que substitui os três temas quando não há tema de hoje. */
export type AvisoSemTema = { titulo: string; texto: string };

/**
 * O que se sabe do ramo da marca quando não há tema (E45 PR 2). Cada um vale mais que o seguinte e que o horário, nesta ordem:
 * `emConferencia` (a marca ainda não tem ramo: espera o pedido dela), `semBase` (o ramo ainda não tem vídeo nenhum: está começando a ser
 * pesquisado), `aindaLendo` (tem vídeo, a análise ainda não rodou).
 */
export type EstadoDoRamo = { aindaLendo?: boolean; semBase?: boolean; emConferencia?: boolean };

/** "06:30", o horário em que os temas do dia deviam ter saído (job `temas-do-dia`, de madrugada). */
const HORA_TEMAS_PRONTOS = "06:30";

/**
 * H3, item 1: o Hoje é sempre o Hoje das portas, mesmo sem tema ou com a busca de hoje falhando; o
 * que muda é só este aviso, mostrado na porta Reels no lugar dos três temas. Sem tema, o texto
 * depende da hora (`HORA_TEMAS_PRONTOS`, fuso do Brasil): antes, "os temas saem até as 6h30" (ainda
 * pode ser só cedo demais); depois, o tema de hoje já devia ter saído e não saiu.
 *
 * Fora de `page.tsx` de propósito: um arquivo de rota do App Router só pode exportar as poucas
 * chaves especiais do Next (`default`, `metadata`, etc.); qualquer export a mais reprova o build
 * (achado desta rodada, `next build`, "Type 'avisoSemTema' is incompatible with index signature").
 *
 * `aindaLendo` (M1, item 5): o setor já tem vídeo coletado mas a análise ainda não rodou. Vale
 * mais que "cedo demais" ou "não saiu": explica por que, e por isso vence os dois, a qualquer
 * hora, sempre que `temasParaCliente` devolveu `sem_tema` com um nicho de verdade por trás.
 * Um `boolean` no lugar do estado é o `aindaLendo` de antes (os testes e quem chamava assim continuam valendo).
 */
export function avisoSemTema(
  resultado: ResultadoTemasHoje | { status: "erro" },
  agora: Date,
  estadoDoRamo: boolean | EstadoDoRamo = false,
): AvisoSemTema | null {
  const estado: EstadoDoRamo = typeof estadoDoRamo === "boolean" ? { aindaLendo: estadoDoRamo } : estadoDoRamo;
  if (resultado.status === "ok") return null;
  if (resultado.status === "erro") {
    return { titulo: textosHoje.erroTitulo, texto: textosHoje.erro };
  }
  if (estado.emConferencia) {
    return { titulo: textosHoje.ramoEmConferenciaTitulo, texto: textosHoje.ramoEmConferencia };
  }
  if (estado.semBase) {
    return { titulo: textosHoje.ramoNovoTitulo, texto: textosHoje.ramoNovo };
  }
  if (estado.aindaLendo) {
    return { titulo: textosHoje.aindaLendoTitulo, texto: textosHoje.aindaLendo };
  }
  return horaMinutoAtualISO(agora) >= HORA_TEMAS_PRONTOS
    ? { titulo: textosHoje.semTemaDepoisTitulo, texto: textosHoje.semTemaDepois }
    : { titulo: textosHoje.vazioTitulo, texto: textosHoje.vazio };
}

/**
 * Decisão do Gustavo em 27/10/2026: o ramo que ficou 5 dias sem ninguém abrir o aplicativo não ganha tema de madrugada (`setoresEmUso`). Quando alguém volta, o tema de hoje não existe
 * e, se o ramo teve tema nos últimos 3 dias, a tela mostra o dele (regra de estabilidade, `temasDoDiaOuRecente`): uma tela cheia de tema velho não é "vazia", mas também não é o de hoje.
 * Esta regra diz quando, além de mostrar o antigo, vale pedir o de hoje em silêncio: a tela é a de hoje (sem `?data=`), o tema que ela mostra não é de hoje, e a hora já passou das 06:30
 * (antes disso o de ontem é o esperado e a rodada da madrugada ainda vai chegar). O pedido em si (`pedirTemaDeHoje`) não duplica: só sai sem linha de hoje, e uma vez por 10 minutos.
 * O caso sem tema nenhum não passa por aqui: ele pede sempre e mostra "estamos escolhendo os temas".
 */
export function deveRenovarTemaVelho(
  resultado: ResultadoTemasHoje | { status: "erro" },
  hoje: string,
  agora: Date,
  dataInicial?: string,
): boolean {
  if (resultado.status !== "ok") return false;
  if (dataInicial && dataInicial !== hoje) return false;
  if (resultado.dataUsada === hoje) return false;
  return horaMinutoAtualISO(agora) >= HORA_TEMAS_PRONTOS;
}
