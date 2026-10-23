import { Newspaper } from "lucide-react";
import { redirect } from "next/navigation";

import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { pedirFiltroDeNoticias } from "@/servicos/filtro-de-noticias";
import { capaDoDia, type CapaDoDia, type NoticiaDaCapa } from "@/servicos/noticias-do-dia";
import { assuntosEmAltaParaAcompanhar, type AssuntoEmAltaParaAcompanhar } from "@/servicos/palavras-do-assunto";
import { listaDeTendenciasDeAgora } from "@/servicos/tendencias";
import { textosNoticias } from "@/textos/noticias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import type { NoticiaNaTela } from "./CartaoDeNoticia";
import { NoticiasTela } from "./NoticiasTela";

/** Com menos notícias que isto nos últimos dias, abrir a tela pede o filtro do ramo. */
const NOTICIAS_PARA_TELA_CHEIA = 6;
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
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));

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

  // O que está em alta no Brasil agora (E55) vira sugestão no campo do assunto. Leitura do banco, sem custo; se falhar, o campo sugere só pela nossa lista.
  let emAlta: AssuntoEmAltaParaAcompanhar[] = [];
  try {
    emAlta = assuntosEmAltaParaAcompanhar(await listaDeTendenciasDeAgora(agora));
  } catch {
    emAlta = [];
  }

  // Tela magra (poucas notícias nos últimos dias): pede o filtro do ramo agora, em vez de a pessoa esperar a próxima coleta. No máximo um pedido por ramo a cada 30 minutos, e o ver como nunca pede.
  if (!falha && sessao.verComo === null && capa.deHoje.length + capa.deOntem.length < NOTICIAS_PARA_TELA_CHEIA) void pedirFiltroDeNoticias(cliente.nichoId, 1800);

  return (
    <NoticiasTela
      dataPorExtenso={dataPorExtenso(agora)}
      nomeDoSetor={capa.nomeDoSetor}
      deHoje={capa.deHoje.map((n) => paraATela(n, agora))}
      deOntem={capa.deOntem.map((n) => paraATela(n, agora))}
      assuntos={capa.assuntos}
      emAlta={emAlta}
      novasDesdeOntem={capa.novasDesdeOntem}
      falha={falha}
      somenteLeitura={sessao.verComo !== null}
    />
  );
}
