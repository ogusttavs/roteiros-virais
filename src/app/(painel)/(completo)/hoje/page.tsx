import { redirect } from "next/navigation";

import { config, hojeISO } from "@/lib/config";
import { formatarMultiplo } from "@/lib/formatarNumero";
import { sessaoAtual } from "@/lib/sessao";
import { garantirBriefing } from "@/servicos/briefing";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { videoSubindoParaAviso } from "@/servicos/curva";
import { agendaDoDia, proximoDiaMarcado, somarDiasISO, semanaDaAgenda } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";

import { HojeTela, type AvisoBriefingAgenda, type ProximoMarcado } from "./HojeTela";

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
 * `agendaOutroDia`, `agendaBriefingIncompleto`). `?dia=AAAA-MM-DD` troca o dia aberto na semana,
 * sem sair da tela; fora da semana atual ou inválido, cai em hoje (a E39b é que traz o calendário
 * e o "ver o mês").
 */
export default async function Hoje({ searchParams }: Props) {
  const sessao = await sessaoAtual();
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

  const [semana, agenda, videoSubindo, briefing] = await Promise.all([
    semanaDaAgenda(cliente.id, diaVisualizado),
    agendaDoDia(cliente.id, diaVisualizado),
    videoSubindoParaAviso(cliente.id),
    garantirBriefing(cliente.id),
  ]);

  const proximoBruto =
    agenda.reels === null && agenda.stories.length === 0 && ehHoje
      ? await proximoDiaMarcado(cliente.id, somarDiasISO(hoje, 1))
      : null;
  const proximoMarcado: ProximoMarcado | null = proximoBruto
    ? { quando: quandoEhIsso(proximoBruto.data, hoje), rotuloFormato: ROTULO_FORMATO[proximoBruto.formato] }
    : null;

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
      proximoMarcado={proximoMarcado}
      avisoBriefing={avisoBriefing}
      avisoVideoSubindo={avisoVideoSubindo}
      marcaAtiva={cliente}
      marcas={marcas}
      nomePessoa={sessao.user.name}
    />
  );
}
