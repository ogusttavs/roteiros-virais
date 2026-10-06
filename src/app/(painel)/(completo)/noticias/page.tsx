import { Newspaper } from "lucide-react";
import { redirect } from "next/navigation";

import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { capaDoDia, type CapaDoDia, type NoticiaDaCapa } from "@/servicos/noticias-do-dia";
import { textosNoticias } from "@/textos/noticias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import type { NoticiaNaTela } from "./CartaoDeNoticia";
import { NoticiasTela } from "./NoticiasTela";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 24 * 60 * 60 * 1000;

function dataPorExtenso(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: FUSO }).format(agora);
}

/** "07:40" para as de hoje; "ontem" ou "anteontem" para as outras. */
function quando(n: NoticiaDaCapa, agora: Date): string {
  if (!n.publicadoEm) return "";
  const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
  if (dia(n.publicadoEm) === dia(agora)) return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO }).format(n.publicadoEm);
  return dia(n.publicadoEm) === dia(new Date(agora.getTime() - DIA_MS)) ? "ontem" : "anteontem";
}

function paraATela(n: NoticiaDaCapa, agora: Date): NoticiaNaTela {
  return {
    chave: n.chave,
    tipo: n.tipo,
    noticiaId: n.noticiaId,
    assuntoId: n.assuntoId,
    origemRotulo: n.origemRotulo,
    titulo: n.titulo,
    veiculo: n.veiculo,
    quando: quando(n, agora),
    resumo: n.resumo,
    url: n.url,
    imagemUrl: n.imagemUrl,
    imagemCredito: n.imagemCredito,
    roteiroId: n.roteiroId,
  };
}

/**
 * `/noticias` (E53, passo 20): a capa do dia, o blog que a pessoa abre todo dia. Só leitura; os assuntos mudam por Server Actions (`acoes.ts`) que o "ver como" recusa. Falha ao ler não
 * derruba a tela: sem notícia, o aviso e o "Tentar de novo".
 */
export default async function Noticias() {
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect("/entrar");

  if (!cliente.nichoId) {
    return <EstadoVazio icone={<Newspaper size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosNoticias.semNicho} />;
  }

  const agora = new Date();
  let capa: CapaDoDia = { nomeDoSetor: "", deHoje: [], deOntem: [], assuntos: [], novasDesdeOntem: 0 };
  let falha = false;
  try {
    capa = await capaDoDia(cliente, agora);
  } catch {
    falha = true;
  }

  return (
    <NoticiasTela
      dataPorExtenso={dataPorExtenso(agora)}
      nomeDoSetor={capa.nomeDoSetor}
      deHoje={capa.deHoje.map((n) => paraATela(n, agora))}
      deOntem={capa.deOntem.map((n) => paraATela(n, agora))}
      assuntos={capa.assuntos}
      novasDesdeOntem={capa.novasDesdeOntem}
      falha={falha}
      somenteLeitura={sessao.verComo !== null}
    />
  );
}
