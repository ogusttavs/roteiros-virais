"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { Plataforma } from "@/db/schema";
import { FORMATOS_EM_ORDEM } from "@/ia/enums";
import type { VideoReferencia } from "@/servicos/pesquisa";
import { textosReferencias } from "@/textos/referencias";
import { Chips, SeparadorChips } from "@/ui/componentes/Chips";
import chipsStyles from "@/ui/componentes/Chips.module.css";
import { ReferenciaCartao } from "@/ui/componentes/ReferenciaCartao";
import { Toast } from "@/ui/componentes/Toast";

import { desfavoritarAction, favoritarAction } from "./acoes";
import styles from "./ReferenciasTela.module.css";

type Props = { videos: VideoReferencia[]; favoritosIniciais: number[] };

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_POR_PERIODO = [7, 30, 90];
const PLATAFORMA_POR_INDICE: (Plataforma | null)[] = [null, "youtube", "tiktok", "instagram"];

const FORMATAR_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  timeZone: "America/Sao_Paulo",
});

function formatarVezes(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
}

/** `/referencias` (etapa 12, brief-frontend.md 6.6, `ReferenciasTela.dc.html`). */
export function ReferenciasTela({ videos, favoritosIniciais }: Props) {
  const router = useRouter();
  const [plataforma, setPlataforma] = useState(0);
  const [periodo, setPeriodo] = useState(0);
  const [formato, setFormato] = useState<number | null>(null);
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [favoritos, setFavoritos] = useState(() => new Set(favoritosIniciais));
  const [toastAberto, setToastAberto] = useState(false);
  const [jaMostrouToast, setJaMostrouToast] = useState(false);
  const [, iniciarTransicao] = useTransition();

  const filtrados = useMemo(() => {
    const plataformaFiltro = PLATAFORMA_POR_INDICE[plataforma];
    const limiteData = Date.now() - DIAS_POR_PERIODO[periodo] * DIA_MS;
    const formatoFiltro = formato === null ? null : FORMATOS_EM_ORDEM[formato];

    return videos.filter((v) => {
      if (plataformaFiltro && v.plataforma !== plataformaFiltro) return false;
      if (v.publicadoEm && v.publicadoEm.getTime() < limiteData) return false;
      if (formatoFiltro && v.formato !== formatoFiltro) return false;
      if (soFavoritos && !favoritos.has(v.id)) return false;
      return true;
    });
  }, [videos, plataforma, periodo, formato, soFavoritos, favoritos]);

  /** Otimista: o marcador muda na hora; se a gravação falhar, desfaz. */
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
      }
    });
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <h1 className={styles.titulo}>{textosReferencias.titulo}</h1>
        <p className={styles.linha}>{textosReferencias.linha}</p>
      </div>

      <div className={styles.filtros}>
        <Chips
          rotuloGrupo="Plataforma"
          opcoes={textosReferencias.plataformas}
          selecionado={plataforma}
          onChange={setPlataforma}
        />
        <SeparadorChips />
        <Chips
          rotuloGrupo="Período"
          opcoes={textosReferencias.periodos}
          selecionado={periodo}
          onChange={setPeriodo}
        />
        <SeparadorChips />
        <Chips
          rotuloGrupo="Formato"
          opcoes={textosReferencias.formatos}
          selecionado={formato}
          onChange={setFormato}
        />
        <SeparadorChips />
        <button
          type="button"
          aria-pressed={soFavoritos}
          onClick={() => setSoFavoritos((v) => !v)}
          className={[chipsStyles.chip, soFavoritos ? chipsStyles.ativo : ""].filter(Boolean).join(" ")}
        >
          {textosReferencias.favoritos}
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className={styles.semResultado}>
          <p className={styles.semResultadoTexto}>{textosReferencias.semResultado}</p>
          <button type="button" className={styles.ver90} onClick={() => setPeriodo(2)}>
            {textosReferencias.ver90}
          </button>
        </div>
      ) : (
        <div className={styles.grade}>
          {filtrados.map((v) => (
            <ReferenciaCartao
              key={v.id}
              vezes={formatarVezes(v.foraDaCurva)}
              rotuloVezes={textosReferencias.acimaDoNormal}
              conta={v.contaHandle ?? "conta não identificada"}
              data={v.publicadoEm ? FORMATAR_DATA.format(v.publicadoEm) : ""}
              analise={[
                { rotulo: textosReferencias.analise.comecou, texto: v.gancho },
                { rotulo: textosReferencias.analise.construiu, texto: v.estrutura },
                { rotulo: textosReferencias.analise.funcionou, texto: v.porQueFuncionou },
              ]}
              embed={{
                url: v.url,
                alt: `vídeo de ${v.contaHandle ?? "referência"}, 9 por 16, carrega ao entrar na tela`,
                rotuloCarregamento: "vídeo embedado 9:16 · carrega ao entrar na tela",
                linkExterno: { rotulo: textosReferencias.abrirVideo, href: v.url },
              }}
              salvo={favoritos.has(v.id)}
              rotuloUsar={textosReferencias.usar}
              rotuloSalvar={favoritos.has(v.id) ? textosReferencias.remover : textosReferencias.salvar}
              onSalvar={() => alternarFavorito(v.id)}
              onUsar={() => router.push(`/hoje/tema-livre?tema=${encodeURIComponent(v.assunto)}`)}
            />
          ))}
        </div>
      )}

      <Toast texto={textosReferencias.toast} aberto={toastAberto} onFechar={() => setToastAberto(false)} />
    </div>
  );
}
