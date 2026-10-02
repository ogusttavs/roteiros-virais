import { Newspaper } from "lucide-react";
import { redirect } from "next/navigation";

import { formatarDataHoraPorExtenso, formatarFonteEData } from "@/lib/formatarNumero";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { contagemNoticiasNaSemana, noticiasDoSetor, type NoticiaListada, type PeriodoNoticias } from "@/servicos/noticias";
import { textosNoticias } from "@/textos/noticias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { NoticiasTela, type NoticiaFormatada } from "./NoticiasTela";

const PERIODOS_VALIDOS = new Set<string>(["hoje", "semana", "mes"]);

type Props = { searchParams: Promise<{ periodo?: string }> };

function formatarNoticia(n: NoticiaListada): NoticiaFormatada {
  return {
    id: n.id,
    titulo: n.titulo,
    url: n.url,
    resumo: n.resumo,
    angulo: n.angulo,
    fonteEDataRelativa: formatarFonteEData(n.fonte, n.publicadoEm),
    fonteEDataCompleta: n.fonte && n.publicadoEm
      ? `${n.fonte} · ${formatarDataHoraPorExtenso(n.publicadoEm)}`
      : (n.publicadoEm ? formatarDataHoraPorExtenso(n.publicadoEm) : (n.fonte ?? "")),
    virouRoteiro: n.virouRoteiro,
    roteiroId: n.roteiroId,
  };
}

/**
 * `/noticias` (E43, decisão do Gustavo em 01/10, 22:20: aba própria, não um segmento de
 * Referências). O filtro Hoje/Semana/Mês é navegação de servidor (`?periodo=`), igual ao período
 * de Referências; a tela é só leitura, a coleta e o filtro de relevância rodam em `jobs/`.
 */
export default async function Noticias({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  if (!cliente.nichoId) {
    return <EstadoVazio icone={<Newspaper size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosNoticias.semNicho} />;
  }

  const params = await searchParams;
  // Dúvida 2 do passo 11: Semana é o período de entrada (Hoje vazio é o caso comum).
  const periodo: PeriodoNoticias = PERIODOS_VALIDOS.has(params.periodo ?? "") ? (params.periodo as PeriodoNoticias) : "semana";

  let noticias: NoticiaListada[];
  let falhaNaColeta = false;
  try {
    noticias = await noticiasDoSetor(cliente.nichoId, cliente.id, periodo);
  } catch {
    // Dúvida 12 do passo 11: a falha não esconde o que já tínhamos; cai para a semana, sem filtro.
    falhaNaColeta = true;
    noticias = periodo === "semana" ? [] : await noticiasDoSetor(cliente.nichoId, cliente.id, "semana");
  }

  const contagemSemana = await contagemNoticiasNaSemana(cliente.nichoId);

  return (
    <NoticiasTela
      noticias={noticias.map(formatarNoticia)}
      periodo={periodo}
      contagemSemana={contagemSemana}
      falhaNaColeta={falhaNaColeta}
    />
  );
}
