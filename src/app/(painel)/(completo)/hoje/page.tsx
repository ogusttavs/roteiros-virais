import { redirect } from "next/navigation";

import { config, hojeISO } from "@/lib/config";
import {
  classificarMultiplo,
  diasDesde,
  formatarMultiplo,
  formatarViewsCompacto,
  fraseDiasAtras,
  rotuloMultiploConta,
} from "@/lib/formatarNumero";
import { sessaoDoPainel } from "@/lib/ver-como";
import { garantirBriefing } from "@/servicos/briefing";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { videoSubindoParaAviso } from "@/servicos/curva";
import { cartaoEmAltaSemFalha } from "@/servicos/em-alta";
import { evidenciaResumoPorIds, type EvidenciaResumo } from "@/servicos/pesquisa";
import { agendaDoDia, atrasados, proximoDiaMarcado, somarDiasISO, semanaDaAgenda } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";

import { HojeTela, type AindaValeAgenda, type AvisoBriefingAgenda, type ProximoMarcado } from "./HojeTela";

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

type Props = { searchParams: Promise<{ dia?: string }> };

/**
 * `/hoje` vira a agenda (E39a, design v2, `Hoje.dc.html`, estados `agenda`, `agendaVazia`,
 * `agendaOutroDia`, `agendaBriefingIncompleto`). `?dia=AAAA-MM-DD` troca o dia aberto nos próximos 7 dias,
 * sem sair da tela; fora da janela atual ou inválido, cai em hoje (a E39b é que traz o calendário
 * e o "ver o mês").
 */
export default async function Hoje({ searchParams }: Props) {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, marcas] = await Promise.all([clienteAtivoDoUsuario(sessao.user.id), marcasDoUsuario(sessao.user.id)]);
  if (!cliente) {
    redirect("/entrar");
  }

  const hoje = hojeISO();
  const { dia } = await searchParams;
  const diaVisualizado = validarDiaDaUrl(dia, hoje);
  const ehHoje = diaVisualizado === hoje;

  const [semana, agendaDoDiaTodo, videoSubindo, briefing, atrasadosDoDia, emAlta] = await Promise.all([
    semanaDaAgenda(cliente.id, diaVisualizado),
    agendaDoDia(cliente.id, diaVisualizado),
    videoSubindoParaAviso(cliente.id),
    garantirBriefing(cliente.id),
    ehHoje ? atrasados(cliente.id, hoje) : Promise.resolve([]),
    // E55 PR 2: o assunto em alta hoje, só em hoje. Uma falha aqui nunca derruba a agenda (o cartão só não aparece, e a falha vai para o log).
    ehHoje ? cartaoEmAltaSemFalha(cliente, hoje) : Promise.resolve(null),
  ]);

  // O roteiro que a marca já criou do assunto em alta mora dentro do cartão "Em alta hoje", não em "Reels de hoje" (dúvida 4 do passo 21).
  // O roteiro do cartão pode ser um Reels ou um Story (o Criar deixa escolher), então sai das duas listas.
  const agenda = emAlta?.roteiro
    ? {
        ...agendaDoDiaTodo,
        reels: agendaDoDiaTodo.reels.filter((item) => item.id !== emAlta.roteiro?.id),
        stories: agendaDoDiaTodo.stories.filter((item) => item.id !== emAlta.roteiro?.id),
      }
    : agendaDoDiaTodo;

  const proximoBruto =
    agenda.reels.length === 0 && agenda.stories.length === 0 && ehHoje
      ? await proximoDiaMarcado(cliente.id, somarDiasISO(hoje, 1))
      : null;
  const proximoMarcado: ProximoMarcado | null = proximoBruto
    ? { quando: quandoEhIsso(proximoBruto.data, hoje), rotuloFormato: ROTULO_FORMATO[proximoBruto.formato] }
    : null;

  /**
   * E39b, item (a): "ainda vale?", só no Reels em destaque de hoje, quando foi escrito antes de
   * hoje e continua "a gravar". A formatação da evidência (quando a resposta é "novo") precisa do
   * banco (`evidenciaResumoPorIds`), por isso acontece aqui, não no cliente.
   */
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
      ? {
          nota: notaBriefing.toFixed(1).replace(".", ","),
          meta: String(config.regras.notaMinimaBriefing),
        }
      : null;

  const avisoVideoSubindo = videoSubindo
    ? textosHoje.avisoVideoSubindo(
        diaDaSemana(hojeISO(videoSubindo.postadoEm)),
        formatarMultiplo(videoSubindo.multiplicador),
      )
    : null;

  return (
    <HojeTela
      semana={semana}
      diaVisualizado={diaVisualizado}
      ehHoje={ehHoje}
      diaVisualizadoExtenso={dataPorExtenso(diaVisualizado)}
      agenda={agenda}
      atrasados={atrasadosDoDia}
      aindaVale={aindaVale}
      proximoMarcado={proximoMarcado}
      avisoBriefing={avisoBriefing}
      avisoVideoSubindo={avisoVideoSubindo}
      emAlta={emAlta}
      marcaAtiva={cliente}
      marcas={marcas}
      nomePessoa={sessao.user.name}
    />
  );
}
