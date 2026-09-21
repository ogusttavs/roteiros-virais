"use client";

import { Bookmark, Filter, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { AnaliseVideo, Plataforma } from "@/db/schema";
import { classificarMultiplo, formatarMultiplo, rotuloMultiploConta } from "@/lib/formatarNumero";
import type { ContagensFiltroReferencias, VideoReferencia } from "@/servicos/pesquisa";
import { textosReferencias } from "@/textos/referencias";
import { Botao } from "@/ui/componentes/Botao";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";
import { ReferenciaCartao, type VideoFormatado } from "@/ui/componentes/ReferenciaCartao";
import { Toast } from "@/ui/componentes/Toast";

import { desfavoritarAction, favoritarAction } from "./acoes";
import { FolhaDetalhesVideo } from "./FolhaDetalhesVideo";
import { FolhaFiltrarReferencias } from "./FolhaFiltrarReferencias";
import styles from "./ReferenciasTela.module.css";

export type Segmento = "foradacurva" | "salvos";

type Props = {
  videos: VideoReferencia[];
  total: number;
  favoritosIniciais: number[];
  segmento: Segmento;
  periodoDias: number;
  busca: string;
  plataformasAtivas: Plataforma[];
  formatosAtivos: AnaliseVideo["formato"][];
  contagensFiltro: ContagensFiltroReferencias;
};

const ROTULO_PLATAFORMA: Record<Plataforma, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

const FORMATAR_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function formatarVideo(v: VideoReferencia): VideoFormatado {
  const faixa = classificarMultiplo(v.foraDaCurva);
  return {
    id: v.id,
    url: v.url,
    multiplo: formatarMultiplo(v.foraDaCurva),
    rotuloMultiplo: rotuloMultiploConta(faixa, v.contaMedianaOrigem),
    faixaMultiplo: faixa,
    views: v.views,
    medianaConta: v.medianaConta,
    velocidade: v.velocidade,
    contaNome: v.contaNome ?? v.contaHandle ?? textosReferencias.contaNaoIdentificada,
    plataformaData: v.publicadoEm
      ? `${ROTULO_PLATAFORMA[v.plataforma]}, ${FORMATAR_DATA.format(v.publicadoEm)}`
      : ROTULO_PLATAFORMA[v.plataforma],
    titulo: v.titulo,
    assunto: v.assunto,
    gancho: v.gancho,
    estrutura: v.estrutura,
    porQueFuncionou: v.porQueFuncionou,
  };
}

/** "no Instagram", "no Instagram e no YouTube", "no Instagram, no YouTube e no TikTok". */
function juntarPlataformas(plataformas: Plataforma[]): string {
  const nomes = plataformas.map((p) => `no ${ROTULO_PLATAFORMA[p]}`);
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

function montarUrl(filtros: {
  segmento: Segmento;
  periodoDias: number;
  busca: string;
  plataformas: Plataforma[];
  formatos: AnaliseVideo["formato"][];
}): string {
  const params = new URLSearchParams();
  if (filtros.segmento !== "foradacurva") params.set("seg", filtros.segmento);
  if (filtros.periodoDias !== 7) params.set("periodo", String(filtros.periodoDias));
  if (filtros.busca.trim()) params.set("busca", filtros.busca.trim());
  if (filtros.plataformas.length > 0) params.set("plataforma", filtros.plataformas.join(","));
  if (filtros.formatos.length > 0) params.set("formato", filtros.formatos.join(","));
  const query = params.toString();
  return query ? `/referencias?${query}` : "/referencias";
}

/**
 * `/referencias` (V6, D2 parte 3a; design v2, `Referencias.dc.html`, estados
 * `normal`, `filtrar`, `detalhes`, `vazio`, `erro`; `todos`, `todosFiltrar` e
 * `noticias` ficam para a parte 3b). Os filtros vivem na URL; esta tela só
 * cuida de interação (folhas, favoritar otimista) e monta a URL nova ao
 * aplicar um filtro, deixando o Server Component (`page.tsx`) reconsultar.
 */
export function ReferenciasTela({
  videos,
  total,
  favoritosIniciais,
  segmento,
  periodoDias,
  busca,
  plataformasAtivas,
  formatosAtivos,
  contagensFiltro,
}: Props) {
  const router = useRouter();
  const [campoBusca, setCampoBusca] = useState(busca);
  const [folhaFiltrarAberta, setFolhaFiltrarAberta] = useState(false);
  const [videoDetalheId, setVideoDetalheId] = useState<number | null>(null);
  const [favoritos, setFavoritos] = useState(() => new Set(favoritosIniciais));
  const [toastAberto, setToastAberto] = useState(false);
  const [jaMostrouToast, setJaMostrouToast] = useState(false);
  const [idPendente, setIdPendente] = useState<number | null>(null);
  const [, iniciarTransicao] = useTransition();

  const formatados = useMemo(() => videos.map(formatarVideo), [videos]);
  const videoDetalhe = formatados.find((v) => v.id === videoDetalheId) ?? null;
  const urlDetalhe = videos.find((v) => v.id === videoDetalheId)?.url ?? null;

  const quantosFiltrosAtivos = plataformasAtivas.length + formatosAtivos.length;

  function navegar(mudanca: Partial<Parameters<typeof montarUrl>[0]>) {
    router.push(
      montarUrl({
        segmento,
        periodoDias,
        busca,
        plataformas: plataformasAtivas,
        formatos: formatosAtivos,
        ...mudanca,
      }),
    );
  }

  /** Otimista: o marcador muda na hora; se a gravação falhar, desfaz (mesma lição da etapa 12). */
  function alternarFavorito(videoId: number) {
    const jaSalvo = favoritos.has(videoId);
    const primeiraVez = !jaSalvo && !jaMostrouToast;

    setFavoritos((atual) => {
      const proximo = new Set(atual);
      if (jaSalvo) proximo.delete(videoId);
      else proximo.add(videoId);
      return proximo;
    });
    if (primeiraVez) {
      setToastAberto(true);
      setJaMostrouToast(true);
    }

    setIdPendente(videoId);
    iniciarTransicao(async () => {
      try {
        if (jaSalvo) await desfavoritarAction(videoId);
        else await favoritarAction(videoId);
      } catch {
        setFavoritos((atual) => {
          const proximo = new Set(atual);
          if (jaSalvo) proximo.add(videoId);
          else proximo.delete(videoId);
          return proximo;
        });
      } finally {
        setIdPendente((atual) => (atual === videoId ? null : atual));
      }
    });
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoTela}>
        <h1>{textosReferencias.titulo}</h1>
        <p>{textosReferencias.linha}</p>
      </div>

      <div className={styles.filtros}>
        <div className={styles.segmentado} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={segmento === "foradacurva"}
            className={[styles.segmentoBotao, segmento === "foradacurva" ? styles.segmentoAtivo : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => router.push(montarUrl({ segmento: "foradacurva", periodoDias, busca, plataformas: [], formatos: [] }))}
          >
            {textosReferencias.segmentoForaDaCurva}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={segmento === "salvos"}
            className={[styles.segmentoBotao, segmento === "salvos" ? styles.segmentoAtivo : ""].filter(Boolean).join(" ")}
            onClick={() => router.push(montarUrl({ segmento: "salvos", periodoDias, busca, plataformas: [], formatos: [] }))}
          >
            {textosReferencias.segmentoSalvos}
          </button>
        </div>

        <div className={styles.filtrosLinha}>
          <span className={styles.busca}>
            <Search size={18} strokeWidth={1.5} aria-hidden="true" />
            <input
              placeholder={textosReferencias.buscaPlaceholder}
              value={campoBusca}
              onChange={(evento) => setCampoBusca(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === "Enter") navegar({ busca: campoBusca });
              }}
              onBlur={() => {
                if (campoBusca !== busca) navegar({ busca: campoBusca });
              }}
            />
          </span>
          <select
            className={styles.seletorPeriodo}
            aria-label={textosReferencias.rotuloPeriodo}
            value={periodoDias}
            onChange={(evento) => navegar({ periodoDias: Number(evento.target.value) })}
          >
            {textosReferencias.periodos.map((p) => (
              <option key={p.dias} value={p.dias}>
                {p.rotulo}
              </option>
            ))}
          </select>
          <Botao variante="secundario" tamanho="md" onClick={() => setFolhaFiltrarAberta(true)} className={styles.botaoFiltrar}>
            <Filter size={16} strokeWidth={1.5} aria-hidden="true" />
            {textosReferencias.filtrar}
            {quantosFiltrosAtivos > 0 ? <span className={styles.quantosAtivos}>, {quantosFiltrosAtivos}</span> : null}
          </Botao>
        </div>
      </div>

      {formatados.length === 0 ? (
        segmento === "salvos" ? (
          <EstadoVazio
            icone={<Bookmark size={24} strokeWidth={1.5} aria-hidden="true" />}
            frase={textosReferencias.vazioTextoSalvos}
          />
        ) : (
          <div className={styles.blocoVazio}>
            <h3>{textosReferencias.vazioTitulo}</h3>
            <p>{textosReferencias.vazioTexto(periodoDias, juntarPlataformas(plataformasAtivas))}</p>
            <div className={styles.blocoVazioAcoes}>
              <Botao variante="primario" tamanho="lg" onClick={() => navegar({ periodoDias: 30 })}>
                {textosReferencias.ver30Dias}
              </Botao>
              <Botao
                variante="secundario"
                tamanho="lg"
                onClick={() => {
                  setCampoBusca("");
                  navegar({ busca: "", plataformas: [], formatos: [] });
                }}
              >
                {textosReferencias.limparFiltros}
              </Botao>
            </div>
          </div>
        )
      ) : (
        <>
          <p className={styles.contagem}>
            {segmento === "salvos" ? textosReferencias.contagemSalvos(total) : textosReferencias.contagem(total, periodoDias)}
          </p>
          <div className={styles.grade}>
            {formatados.map((video) => (
              <ReferenciaCartao
                key={video.id}
                video={video}
                salvo={favoritos.has(video.id)}
                salvando={idPendente === video.id}
                onVerDetalhes={() => setVideoDetalheId(video.id)}
                onSalvar={() => alternarFavorito(video.id)}
              />
            ))}
          </div>
        </>
      )}

      <FolhaDetalhesVideo
        video={videoDetalhe}
        url={urlDetalhe}
        aberto={videoDetalheId !== null}
        aoFechar={() => setVideoDetalheId(null)}
        salvo={videoDetalheId !== null && favoritos.has(videoDetalheId)}
        salvando={idPendente === videoDetalheId}
        onUsarComoReferencia={() => {
          if (videoDetalheId !== null && !favoritos.has(videoDetalheId)) alternarFavorito(videoDetalheId);
        }}
        onSalvar={() => {
          if (videoDetalheId !== null) alternarFavorito(videoDetalheId);
        }}
      />

      <FolhaFiltrarReferencias
        aberto={folhaFiltrarAberta}
        aoFechar={() => setFolhaFiltrarAberta(false)}
        plataformasAtivas={plataformasAtivas}
        formatosAtivos={formatosAtivos}
        contagens={contagensFiltro}
        totalAtual={total}
        onAplicar={({ plataformas, formatos }) => {
          setFolhaFiltrarAberta(false);
          navegar({ plataformas, formatos });
        }}
      />

      <Toast texto={textosReferencias.toast} aberto={toastAberto} onFechar={() => setToastAberto(false)} />
    </div>
  );
}
