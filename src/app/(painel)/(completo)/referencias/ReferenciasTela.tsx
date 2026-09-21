"use client";

import { Filter, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";

import type { AnaliseVideo, Plataforma } from "@/db/schema";
import { classificarMultiplo, formatarMultiplo, rotuloMultiploConta } from "@/lib/formatarNumero";
import type { ContagensFiltroReferencias, VideoReferencia } from "@/servicos/pesquisa";
import { textosReferencias } from "@/textos/referencias";
import { Botao } from "@/ui/componentes/Botao";
import { ReferenciaCartao, type VideoFormatado } from "@/ui/componentes/ReferenciaCartao";
import { Toast } from "@/ui/componentes/Toast";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

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
 *
 * V7, celular e rede ruim: o botão Voltar fecha as duas folhas em vez de sair
 * da tela; toda navegação mostra andamento e, sem rede, só avisa; o aviso de
 * "salvo" só sai depois que o servidor respondeu.
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
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  const [campoBusca, setCampoBusca] = useState(busca);
  const [folhaFiltrarAberta, setFolhaFiltrarAberta] = useState(false);
  const [videoDetalheId, setVideoDetalheId] = useState<number | null>(null);
  const [favoritos, setFavoritos] = useState(() => new Set(favoritosIniciais));
  const [aviso, setAviso] = useState<{ id: number; texto: string; variante: "sucesso" | "erro" } | null>(null);
  /** Cada aviso ganha um número: o `Toast` remonta (`key`) e reinicia o tempo, em vez de o aviso novo herdar o que restava do anterior. */
  const contadorDeAvisos = useRef(0);
  function mostrarAviso(texto: string, variante: "sucesso" | "erro") {
    contadorDeAvisos.current += 1;
    setAviso({ id: contadorDeAvisos.current, texto, variante });
  }
  // O texto que explica o que "salvar" faz sai só na primeira vez que um salvar dá certo.
  const jaMostrouToast = useRef(false);
  const [idsPendentes, setIdsPendentes] = useState<Set<number>>(() => new Set());
  const [, iniciarTransicao] = useTransition();
  // A navegação (abas, busca, período, filtros) tem a transição própria: o andamento dela não acende o do salvar.
  const [navegando, iniciarNavegacao] = useTransition();
  // Aba e período mostram a escolha na hora; o valor de verdade chega com a página nova e a tela volta a ele sozinha.
  const [segmentoExibido, setSegmentoOtimista] = useOptimistic(segmento);
  const [periodoExibido, setPeriodoOtimista] = useOptimistic(periodoDias);
  const urlPendente = useRef<string | null>(null);
  // Qual vídeo está na folha agora, para um salvar que termina tarde não fechar a folha de outro (ou a de filtros).
  const detalheAtual = useRef<number | null>(null);
  useEffect(() => {
    detalheAtual.current = videoDetalheId;
  });

  // O botão Voltar do celular fecha a folha em vez de sair da tela (V7, item 1 do PROXIMO.md): uma chamada por folha.
  const detalhes = useFolhaNoHistorico(videoDetalheId !== null, () => setVideoDetalheId(null));
  const filtrar = useFolhaNoHistorico(folhaFiltrarAberta, () => setFolhaFiltrarAberta(false));
  const fecharAviso = useCallback(() => setAviso(null), []);

  const formatados = useMemo(() => videos.map(formatarVideo), [videos]);
  const videoDetalhe = formatados.find((v) => v.id === videoDetalheId) ?? null;
  const urlDetalhe = videos.find((v) => v.id === videoDetalheId)?.url ?? null;

  const quantosFiltrosAtivos = plataformasAtivas.length + formatosAtivos.length;

  /**
   * Busca, período, abas e filtros reconsultam o servidor com `router.push`. Sem rede isso não tem `catch`
   * possível: o navegador troca o aplicativo pela página de erro dele e a tela se perde. Por isso, sem rede,
   * só avisa (V7, item 8 do PROXIMO.md); guardar a busca para depois está fora desta etapa.
   */
  function semRedeParaBuscar(): boolean {
    if (!semConexao && navigator.onLine) return false;
    mostrarAviso(textosReferencias.semConexaoParaBuscar, "erro");
    return true;
  }

  function navegar(mudanca: Partial<Parameters<typeof montarUrl>[0]>) {
    if (semRedeParaBuscar()) return;
    // O que está escrito na busca vai junto de qualquer outra mudança: a busca só vale com Enter ou ao sair do
    // campo, e a troca de aba ou de período pode chegar antes e apagá-la da URL.
    const filtros = {
      segmento,
      periodoDias,
      busca: campoBusca,
      plataformas: plataformasAtivas,
      formatos: formatosAtivos,
      ...mudanca,
    };
    const url = montarUrl(filtros);
    // Toque duplo, ou Enter seguido do onBlur, enquanto o mesmo pedido ainda não chegou: um pedido só.
    if (navegando && urlPendente.current === url) return;
    urlPendente.current = url;
    iniciarNavegacao(() => {
      setSegmentoOtimista(filtros.segmento);
      setPeriodoOtimista(filtros.periodoDias);
      router.push(url);
    });
  }

  /**
   * Otimista: o marcador muda na hora; se a gravação falhar, desfaz e diz por quê (V7, item 4 do PROXIMO.md;
   * mesma lição da etapa 12). O aviso de "salvo" só sai depois que o servidor respondeu: antes disso a tela não
   * afirma o que ainda não sabe.
   */
  function alternarFavorito(videoId: number, opcoes: { usarComoReferencia?: boolean } = {}) {
    if (idsPendentes.has(videoId)) return;
    const jaSalvo = favoritos.has(videoId);

    setFavoritos((atual) => {
      const proximo = new Set(atual);
      if (jaSalvo) proximo.delete(videoId);
      else proximo.add(videoId);
      return proximo;
    });
    setIdsPendentes((atual) => new Set(atual).add(videoId));

    iniciarTransicao(async () => {
      try {
        if (jaSalvo) await desfavoritarAction(videoId);
        else await favoritarAction(videoId);
        avisarRedeOk();
        if (!jaSalvo) {
          // "Usar como referência" é a decisão da pessoa: fecha a folha (se ainda for a deste vídeo) e sempre avisa.
          if (opcoes.usarComoReferencia && detalheAtual.current === videoId) detalhes.fechar();
          if (opcoes.usarComoReferencia || !jaMostrouToast.current) {
            jaMostrouToast.current = true;
            mostrarAviso(textosReferencias.toast, "sucesso");
          }
        }
      } catch (erro) {
        setFavoritos((atual) => {
          const proximo = new Set(atual);
          if (jaSalvo) proximo.add(videoId);
          else proximo.delete(videoId);
          return proximo;
        });
        mostrarAviso(tratarFalha(erro, textosReferencias.erroAoSalvar, textosReferencias.erroAoSalvarSemRede), "erro");
      } finally {
        setIdsPendentes((atual) => {
          const proximo = new Set(atual);
          proximo.delete(videoId);
          return proximo;
        });
      }
    });
  }

  function usarComoReferencia() {
    if (videoDetalheId === null) return;
    // Já salvo: não há o que gravar. Fecha a folha e avisa, em vez de deixar um botão que não faz nada.
    if (favoritos.has(videoDetalheId)) {
      detalhes.fechar();
      mostrarAviso(textosReferencias.toast, "sucesso");
      return;
    }
    alternarFavorito(videoDetalheId, { usarComoReferencia: true });
  }

  function aplicarFiltros({ plataformas, formatos }: { plataformas: Plataforma[]; formatos: AnaliseVideo["formato"][] }) {
    // Sem rede a folha continua aberta, com o que foi marcado. Um segundo toque antes de a folha sair é
    // ignorado pelo próprio gancho do histórico (`fecharEDepois` é idempotente).
    if (semRedeParaBuscar()) return;
    filtrar.fecharEDepois(() => navegar({ plataformas, formatos }));
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoTela}>
        <h1>{textosReferencias.titulo}</h1>
        <p>{textosReferencias.linha}</p>
      </div>

      <div className={styles.filtros}>
        <div className={styles.segmentado} role="tablist" aria-busy={navegando || undefined}>
          <button
            type="button"
            role="tab"
            aria-selected={segmentoExibido === "foradacurva"}
            className={[styles.segmentoBotao, segmentoExibido === "foradacurva" ? styles.segmentoAtivo : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => navegar({ segmento: "foradacurva", plataformas: [], formatos: [] })}
          >
            {textosReferencias.segmentoForaDaCurva}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={segmentoExibido === "salvos"}
            className={[styles.segmentoBotao, segmentoExibido === "salvos" ? styles.segmentoAtivo : ""].filter(Boolean).join(" ")}
            onClick={() => navegar({ segmento: "salvos", plataformas: [], formatos: [] })}
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
                if (campoBusca.trim() !== busca) navegar({ busca: campoBusca });
              }}
            />
          </span>
          <select
            className={styles.seletorPeriodo}
            aria-label={textosReferencias.rotuloPeriodo}
            value={periodoExibido}
            onChange={(evento) => navegar({ periodoDias: Number(evento.target.value) })}
          >
            {textosReferencias.periodos.map((p) => (
              <option key={p.dias} value={p.dias}>
                {p.rotulo}
              </option>
            ))}
          </select>
          <Botao
            variante="secundario"
            tamanho="md"
            aria-busy={navegando || undefined}
            onClick={() => setFolhaFiltrarAberta(true)}
            className={styles.botaoFiltrar}
          >
            <Filter size={16} strokeWidth={1.5} aria-hidden="true" />
            {textosReferencias.filtrar}
            {quantosFiltrosAtivos > 0 ? <span className={styles.quantosAtivos}>, {quantosFiltrosAtivos}</span> : null}
          </Botao>
        </div>
      </div>

      {navegando ? (
        <p className={styles.contagem} role="status">
          {textosReferencias.buscando}
        </p>
      ) : null}

      {formatados.length === 0 ? (
        segmento === "salvos" ? (
          <div className={styles.blocoVazio}>
            <h3>{textosReferencias.vazioTituloSalvos}</h3>
            <p>{textosReferencias.vazioTextoSalvos}</p>
          </div>
        ) : (
          <div className={styles.blocoVazio}>
            <h3>{textosReferencias.vazioTitulo}</h3>
            <p>{textosReferencias.vazioTexto(periodoDias, juntarPlataformas(plataformasAtivas))}</p>
            <div className={styles.blocoVazioAcoes}>
              <Botao variante="primario" tamanho="lg" carregando={navegando} onClick={() => navegar({ periodoDias: 30 })}>
                {textosReferencias.ver30Dias}
              </Botao>
              <Botao
                variante="secundario"
                tamanho="lg"
                carregando={navegando}
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
          {navegando ? null : (
            <p className={styles.contagem}>
              {segmento === "salvos" ? textosReferencias.contagemSalvos(total) : textosReferencias.contagem(total, periodoDias)}
            </p>
          )}
          <div className={styles.grade}>
            {formatados.map((video) => (
              <ReferenciaCartao
                key={video.id}
                video={video}
                salvo={favoritos.has(video.id)}
                // Sem rede o salvar também fica desabilitado (o cartão não tem o motivo escrito; a faixa do topo explica).
                salvando={idsPendentes.has(video.id)}
                semRede={semConexao}
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
        aoFechar={detalhes.fechar}
        salvo={videoDetalheId !== null && favoritos.has(videoDetalheId)}
        salvando={videoDetalheId !== null && idsPendentes.has(videoDetalheId)}
        onUsarComoReferencia={usarComoReferencia}
        onSalvar={() => {
          if (videoDetalheId !== null) alternarFavorito(videoDetalheId);
        }}
      />

      {/* Só montada com a folha aberta: a cada abertura a seleção nasce da URL, sem sobras de marcas não aplicadas. */}
      {folhaFiltrarAberta ? (
        <FolhaFiltrarReferencias
          aberto
          aoFechar={filtrar.fechar}
          plataformasAtivas={plataformasAtivas}
          formatosAtivos={formatosAtivos}
          contagens={contagensFiltro}
          totalAtual={total}
          onAplicar={aplicarFiltros}
        />
      ) : null}

      <Toast
        key={aviso?.id ?? 0}
        texto={aviso?.texto ?? ""}
        variante={aviso?.variante}
        aberto={aviso !== null}
        onFechar={fecharAviso}
      />
    </div>
  );
}
