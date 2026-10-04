import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { config, hojeISO } from "@/lib/config";
import {
  classificarMultiplo,
  diasDesde,
  formatarMultiplo,
  formatarViewsCompacto,
  fraseDiasAtras,
  rotuloMultiploConta,
} from "@/lib/formatarNumero";
import { sessaoAtual } from "@/lib/sessao";
import { garantirBriefing } from "@/servicos/briefing";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { videoSubindoParaAviso } from "@/servicos/curva";
import { evidenciaResumoPorIds, type EvidenciaResumo } from "@/servicos/pesquisa";
import { planoDoDia } from "@/servicos/plano";
import {
  agendaDoDia,
  atrasados,
  mesDaAgenda,
  proximoDiaMarcado,
  semanaDaAgenda,
  semanaPlanoDaAgenda,
  inicioDaJanelaISO,
  somarDiasISO,
} from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";

import type { Visao } from "./CabecaPlano";
import { DiaConteudo, type AindaValeAgenda, type AvisoBriefingAgenda, type ProximoMarcado } from "./DiaConteudo";
import { MesConteudo } from "./MesTela";
import { PlanejadorTela, type PropsCabecaPlano } from "./PlanejadorShell";
import { SemanaConteudo } from "./SemanaTela";

function paraEvidenciaTema(resumo: EvidenciaResumo | null): EvidenciaTema | null {
  if (!resumo) return null;
  const faixa = classificarMultiplo(resumo.multiplicador);
  return {
    conta: resumo.contaNome ?? resumo.contaHandle,
    multiplo: formatarMultiplo(resumo.multiplicador),
    rotulo: rotuloMultiploConta(faixa, resumo.contaMedianaOrigem),
    views: formatarViewsCompacto(resumo.views),
    quando: resumo.publicadoEm ? fraseDiasAtras(diasDesde(resumo.publicadoEm)) : fraseDiasAtras(0),
    parecidos: resumo.quantidadeParecidos,
  };
}

const FORMATAR_DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
const FORMATAR_DIA_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});
const FORMATAR_DIA_MES_COM_MES = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });

function diaDaSemana(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return FORMATAR_DIA.format(new Date(Date.UTC(ano, mes - 1, dia, 12))).replace("-feira", "");
}

function dataPorExtenso(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const texto = FORMATAR_DIA_POR_EXTENSO.format(new Date(Date.UTC(ano, mes - 1, dia, 12)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const ROTULO_FORMATO: Record<string, string> = { reels: "Reels", story: "Story" };

/** "Amanhã" quando é o dia seguinte; senão o dia da semana (dúvida 14: "O próximo marcado é amanhã: um Story de manhã"). */
function quandoEhIsso(dataISO: string, hoje: string): string {
  if (dataISO === somarDiasISO(hoje, 1)) return "amanhã";
  return diaDaSemana(dataISO);
}

function validarDiaDaUrl(valor: string | undefined, hoje: string): string {
  if (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  return hoje;
}

/** Abre na visão Semana (decisão do Gustavo de 01/10, 22:15), diferente de `/hoje`, que é só o dia. */
function validarVisao(valor: string | undefined): Visao {
  if (valor === "dia" || valor === "mes") return valor;
  return "semana";
}

function validarAnoMes(valor: string | undefined, dia: string, hoje: string): string {
  if (valor && /^\d{4}-\d{2}$/.test(valor)) return valor;
  return dia.slice(0, 7) || hoje.slice(0, 7);
}

/** "7 a 13 de setembro", ou "30 de setembro a 6 de outubro" quando a semana cruza o mês. */
function tituloSemana(segunda: string, domingo: string): string {
  const [, mesSegunda] = segunda.split("-");
  const [, mesDomingo] = domingo.split("-");
  const [anoS, mesS, diaS] = segunda.split("-").map(Number);
  const [anoD, mesD, diaD] = domingo.split("-").map(Number);
  if (mesSegunda === mesDomingo) {
    const diaFim = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)));
    return `${diaS} a ${diaFim}`;
  }
  const diaInicio = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoS, mesS - 1, diaS, 12)));
  const diaFim = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)));
  return `${diaInicio} a ${diaFim}`;
}

const FORMATAR_DIA_MES_CURTO = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" });
/** "set.", "out." -> "set", "out": sem ponto, para a forma curta do período. */
function mesCurto(data: Date): string {
  return FORMATAR_DIA_MES_CURTO.format(data).replace(/\.$/, "");
}

/**
 * Acabamento da E39c, parte 2a (revisão do Fable no PR #95, 02/10/2026): "28 set a 4 out" em vez
 * de "28 de setembro a 4 de outubro", para caber abaixo de 768px (`CabecaPlano`, `tituloCurto`).
 */
function tituloSemanaCurto(segunda: string, domingo: string): string {
  const [, mesSegunda] = segunda.split("-");
  const [, mesDomingo] = domingo.split("-");
  const [anoS, mesS, diaS] = segunda.split("-").map(Number);
  const [anoD, mesD, diaD] = domingo.split("-").map(Number);
  if (mesSegunda === mesDomingo) {
    const mesFim = mesCurto(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)));
    return `${diaS} a ${diaD} ${mesFim}`;
  }
  const inicio = `${diaS} ${mesCurto(new Date(Date.UTC(anoS, mesS - 1, diaS, 12)))}`;
  const fim = `${diaD} ${mesCurto(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)))}`;
  return `${inicio} a ${fim}`;
}

/** O rótulo pequeno acima do título da visão Semana (A3, a janela de sete dias a partir de hoje): "Próximos 7 dias", "Dias anteriores" ou "Dias à frente". */
function rotuloPeriodoSemana(inicioVisualizado: string, hoje: string): string {
  if (inicioVisualizado === hoje) return textosHoje.agenda.proximosDias;
  return inicioVisualizado < hoje ? textosHoje.agenda.planejador.dias7Anteriores : textosHoje.agenda.planejador.dias7Seguintes;
}

/** O mesmo, para a visão Mês: "Este mês", "Mês passado" ou "Mês que vem". */
function rotuloPeriodoMes(anoMesVisualizado: string, anoMesDeHoje: string): string {
  if (anoMesVisualizado === anoMesDeHoje) return textosHoje.agenda.planejador.esteMes;
  return anoMesVisualizado < anoMesDeHoje ? textosHoje.agenda.planejador.mesPassado : textosHoje.agenda.planejador.mesQueVem;
}

/**
 * `tituloMes`/`mesAdjacente` (iguais aos de `MesTela.tsx`, que não exporta: lá é Client
 * Component, e uma função de lá não atravessa para cá, que é Server Component). Mesma duplicação
 * pequena de `diaAdjacente` (`../hoje/HojeTela.tsx`) já feita em outras telas do planejador.
 */
const FORMATAR_MES = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
function tituloMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const texto = FORMATAR_MES.format(new Date(Date.UTC(ano, mes - 1, 1, 12)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function mesAdjacente(anoMes: string, delta: number): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1 + delta, 1, 12));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Props = { searchParams: Promise<{ visao?: string; dia?: string; mes?: string }> };

/**
 * `/planejamento`, o planejador (passo 12 do Opus; aba própria desde a decisão do Gustavo de
 * 01/10, 22:15, antes dentro da aba Hoje). Dia, Semana e Mês num seletor só (`CabecaPlano`, via
 * `PlanejadorTela`); abre em Semana. `visao` escolhe o que aparece; `dia` é o âncora da visão Dia
 * e Semana, `mes` da visão Mês. `/hoje/mes` (a rota antiga) redireciona para cá.
 */
export default async function Planejamento({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, marcas] = await Promise.all([clienteAtivoDoUsuario(sessao.user.id), marcasDoUsuario(sessao.user.id)]);
  if (!cliente) {
    redirect("/entrar");
  }

  const hoje = hojeISO();
  const { visao: visaoBruta, dia, mes } = await searchParams;
  const visao = validarVisao(visaoBruta);
  const diaVisualizado = validarDiaDaUrl(dia, hoje);
  const ehHoje = diaVisualizado === hoje;

  let cabeca: PropsCabecaPlano;
  let corpo: ReactNode;

  if (visao === "mes") {
    const anoMes = validarAnoMes(mes, diaVisualizado, hoje);
    const diaSelecionado = diaVisualizado.startsWith(anoMes) ? diaVisualizado : hoje.startsWith(anoMes) ? hoje : `${anoMes}-01`;
    const [dias, agendaDoDiaSelecionado, planoDoDiaSelecionado, proximoBruto] = await Promise.all([
      mesDaAgenda(cliente.id, anoMes),
      agendaDoDia(cliente.id, diaSelecionado),
      planoDoDia(cliente.id, diaSelecionado),
      proximoDiaMarcado(cliente.id, diaSelecionado),
    ]);
    const planoSugeridoDoDia = planoDoDiaSelecionado.filter((item) => item.estado === "sugerido");
    const proximoMarcado =
      proximoBruto && agendaDoDiaSelecionado.reels.length === 0 && agendaDoDiaSelecionado.stories.length === 0
        ? { quando: quandoEhIsso(proximoBruto.data, hoje), rotuloFormato: ROTULO_FORMATO[proximoBruto.formato] }
        : null;
    cabeca = {
      rotuloPeriodo: rotuloPeriodoMes(anoMes, hoje.slice(0, 7)),
      tituloPeriodo: tituloMes(anoMes),
      mostrarHoje: anoMes !== hoje.slice(0, 7),
      hrefAnterior: `/planejamento?visao=mes&mes=${mesAdjacente(anoMes, -1)}`,
      hrefSeguinte: `/planejamento?visao=mes&mes=${mesAdjacente(anoMes, 1)}`,
      hrefHoje: "/planejamento?visao=mes",
      hrefPorVisao: {
        dia: `/planejamento?visao=dia&dia=${diaSelecionado}`,
        semana: `/planejamento?visao=semana&dia=${diaSelecionado}`,
        mes: `/planejamento?visao=mes&mes=${anoMes}&dia=${diaSelecionado}`,
      },
    };
    corpo = (
      <MesConteudo
        anoMes={anoMes}
        dias={dias}
        diaSelecionado={diaSelecionado}
        agendaDoDiaSelecionado={agendaDoDiaSelecionado}
        planoSugeridoDoDia={planoSugeridoDoDia}
        hoje={hoje}
        proximoMarcado={proximoMarcado}
      />
    );
  } else if (visao === "dia") {
    const [semana, agenda, videoSubindo, briefing, atrasadosDoDia] = await Promise.all([
      semanaDaAgenda(cliente.id, diaVisualizado),
      agendaDoDia(cliente.id, diaVisualizado),
      videoSubindoParaAviso(cliente.id),
      garantirBriefing(cliente.id),
      ehHoje ? atrasados(cliente.id, hoje) : Promise.resolve([]),
    ]);

    const proximoBruto =
      agenda.reels.length === 0 && agenda.stories.length === 0 && ehHoje
        ? await proximoDiaMarcado(cliente.id, somarDiasISO(hoje, 1))
        : null;
    const proximoMarcado: ProximoMarcado | null = proximoBruto
      ? { quando: quandoEhIsso(proximoBruto.data, hoje), rotuloFormato: ROTULO_FORMATO[proximoBruto.formato] }
      : null;

    const reelsDestaque = agenda.reels[0];
    const feitoAntes =
      ehHoje && reelsDestaque !== undefined && reelsDestaque.status === "gerado" && hojeISO(reelsDestaque.criadoEm) !== hoje;
    let aindaVale: AindaValeAgenda = null;
    if (feitoAntes) {
      const quando = diaDaSemana(hojeISO(reelsDestaque.criadoEm));
      if (!reelsDestaque.aindaValeResultado) {
        aindaVale = { status: "naoConferido", feitoHaDias: diasDesde(reelsDestaque.criadoEm), quando };
      } else if (reelsDestaque.aindaValeResultado.vale) {
        aindaVale = { status: "vale", quando };
      } else {
        const resumo = await evidenciaResumoPorIds([reelsDestaque.aindaValeResultado.videoId]);
        aindaVale = {
          status: "novo",
          quando,
          assunto: reelsDestaque.aindaValeResultado.assunto,
          evidencia: paraEvidenciaTema(resumo),
        };
      }
    }

    const notaBriefing = Number(briefing.notaGeral);
    const avisoBriefing: AvisoBriefingAgenda | null =
      notaBriefing < config.regras.notaMinimaBriefing
        ? { nota: notaBriefing.toFixed(1).replace(".", ","), meta: String(config.regras.notaMinimaBriefing) }
        : null;

    const avisoVideoSubindo = videoSubindo
      ? textosHoje.avisoVideoSubindo(diaDaSemana(hojeISO(videoSubindo.postadoEm)), formatarMultiplo(videoSubindo.multiplicador))
      : null;

    cabeca = {
      rotuloPeriodo: ehHoje ? dataPorExtenso(diaVisualizado) : textosHoje.agenda.marcadoPara,
      tituloPeriodo: ehHoje ? textosHoje.titulo : dataPorExtenso(diaVisualizado),
      mostrarHoje: !ehHoje,
      hrefAnterior: `/planejamento?visao=dia&dia=${somarDiasISO(diaVisualizado, -1)}`,
      hrefSeguinte: `/planejamento?visao=dia&dia=${somarDiasISO(diaVisualizado, 1)}`,
      hrefHoje: "/planejamento?visao=dia",
      hrefPorVisao: {
        dia: `/planejamento?visao=dia&dia=${diaVisualizado}`,
        semana: `/planejamento?visao=semana&dia=${diaVisualizado}`,
        mes: `/planejamento?visao=mes&dia=${diaVisualizado}`,
      },
    };
    corpo = (
      <DiaConteudo
        semana={semana}
        diaVisualizado={diaVisualizado}
        ehHoje={ehHoje}
        agenda={agenda}
        atrasados={atrasadosDoDia}
        aindaVale={aindaVale}
        proximoMarcado={proximoMarcado}
        avisoBriefing={avisoBriefing}
        avisoVideoSubindo={avisoVideoSubindo}
      />
    );
  } else {
    // A3, item 1: os sete dias a partir de hoje (blocos de sete contados de hoje), nunca de segunda a domingo.
    const segunda = inicioDaJanelaISO(diaVisualizado, hoje);
    const domingo = somarDiasISO(segunda, 6);
    const dias = await semanaPlanoDaAgenda(cliente.id, diaVisualizado);
    cabeca = {
      rotuloPeriodo: rotuloPeriodoSemana(segunda, hoje),
      tituloPeriodo: tituloSemana(segunda, domingo),
      tituloPeriodoCurto: tituloSemanaCurto(segunda, domingo),
      mostrarHoje: segunda !== hoje,
      hrefAnterior: `/planejamento?visao=semana&dia=${somarDiasISO(diaVisualizado, -7)}`,
      hrefSeguinte: `/planejamento?visao=semana&dia=${somarDiasISO(diaVisualizado, 7)}`,
      hrefHoje: "/planejamento?visao=semana",
      hrefPorVisao: {
        dia: `/planejamento?visao=dia&dia=${diaVisualizado}`,
        semana: `/planejamento?visao=semana&dia=${diaVisualizado}`,
        mes: `/planejamento?visao=mes&dia=${diaVisualizado}`,
      },
    };
    corpo = <SemanaConteudo dias={dias} />;
  }

  return (
    <PlanejadorTela visao={visao} cabeca={cabeca} marcaAtiva={cliente} marcas={marcas} nomePessoa={sessao.user.name}>
      {corpo}
    </PlanejadorTela>
  );
}
