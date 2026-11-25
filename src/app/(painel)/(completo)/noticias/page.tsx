import { Newspaper } from "lucide-react";
import { redirect } from "next/navigation";

import { noticiaServeParaCapa } from "@/carrossel/capa-noticia";
import { carrosselAtivo } from "@/config/carrossel";
import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { recenciaDaNoticia, saiuAgora } from "@/lib/recencia-da-noticia";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { pedirFiltroDeNoticias } from "@/servicos/filtro-de-noticias";
import { capaDoDia, DIAS_DA_CAPA, type CapaDoDia, type NoticiaDaCapa } from "@/servicos/noticias-do-dia";
import { assuntosEmAltaParaAcompanhar, type AssuntoEmAltaParaAcompanhar } from "@/servicos/palavras-do-assunto";
import { listaDeTendenciasDeAgora } from "@/servicos/tendencias";
import { textosNoticias } from "@/textos/noticias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import type { NoticiaNaTela } from "./CartaoDeNoticia";
import { NoticiasTela } from "./NoticiasTela";

/** Com menos notícias que isto nos últimos dias, abrir a tela pede o filtro do ramo. */
const NOTICIAS_PARA_TELA_CHEIA = 6;
const FUSO = "America/Sao_Paulo";
/** A janela ampliada ("Ver a última semana"): é também o máximo que a notícia vale (`DIAS_MAXIMOS_DA_NOTICIA`). */
const DIAS_DA_JANELA_AMPLIADA = 7;

function dataPorExtenso(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: FUSO }).format(agora);
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
    quando: recenciaDaNoticia(n.publicadoEm, agora),
    saiuAgora: saiuAgora(n.publicadoEm, agora),
    resumo: n.resumo,
    url: n.url,
    imagemUrl: n.imagemUrl,
    imagemCredito: n.imagemCredito,
    roteiroId: n.roteiroId,
    podeVirarCapa: carrosselAtivo() && n.tipo === "setor" && noticiaServeParaCapa({ publicadoEm: n.publicadoEm, fonte: n.veiculo }, agora),
  };
}

/**
 * `/noticias` (E53, passo 20): a capa do dia, o blog que a pessoa abre todo dia. Só leitura; os assuntos mudam por Server Actions (`acoes.ts`) que o "ver como" recusa. Falha ao ler não
 * derruba a tela: sem notícia, o aviso e o "Tentar de novo".
 */
export default async function Noticias({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const dias = ver === "semana" ? DIAS_DA_JANELA_AMPLIADA : DIAS_DA_CAPA;
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));

  if (!cliente.nichoId) {
    return <EstadoVazio icone={<Newspaper size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosNoticias.semNicho} />;
  }

  const agora = new Date();
  let capa: CapaDoDia = { nomeDoSetor: "", deHoje: [], deOntem: [], assuntos: [], novasDesdeOntem: 0, dias };
  let falha = false;
  try {
    capa = await capaDoDia(cliente, agora, dias);
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
      dias={dias}
      somenteLeitura={sessao.verComo !== null}
    />
  );
}
