"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import type { AnaliseVideo, Plataforma } from "@/db/schema";
import { FORMATOS_EM_ORDEM, ROTULO_FORMATO, ROTULO_TIPO_CONTEUDO_FILTRAVEL, TIPOS_CONTEUDO_FILTRAVEIS_EM_ORDEM } from "@/ia/enums";
import type { ContagensFiltroReferencias, OrdemReferencias, TipoConteudoFiltravel } from "@/servicos/pesquisa";
import { textosReferencias } from "@/textos/referencias";
import { Folha } from "@/ui/componentes/Folha";

import styles from "./FolhaFiltrarReferencias.module.css";

const PLATAFORMAS_EM_ORDEM: { valor: Plataforma; rotulo: string }[] = [
  { valor: "tiktok", rotulo: "TikTok" },
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "youtube", rotulo: "YouTube" },
];

const ORDENS_EM_ORDEM: { valor: OrdemReferencias; rotulo: string }[] = [
  { valor: "recentes", rotulo: "Mais recentes" },
  { valor: "views", rotulo: "Mais views" },
  { valor: "multiplo", rotulo: "Mais vezes acima do normal da conta" },
  { valor: "velocidade", rotulo: "Mais views por hora" },
];

export type FiltrosAplicados = {
  plataformas: Plataforma[];
  formatos: AnaliseVideo["formato"][];
  ordem: OrdemReferencias | undefined;
  viewsMin: number | undefined;
  comFala: boolean | undefined;
  brasil: boolean | undefined;
  tiposConteudo: TipoConteudoFiltravel[];
};

type Props = {
  aberto: boolean;
  aoFechar: () => void;
  plataformasAtivas: Plataforma[];
  formatosAtivos: AnaliseVideo["formato"][];
  ordem: OrdemReferencias | undefined;
  viewsMin: number | undefined;
  comFala: boolean | undefined;
  brasil: boolean | undefined;
  tiposConteudo: TipoConteudoFiltravel[];
  contagens: ContagensFiltroReferencias;
  /** O total já carregado (não recalcula ao marcar/desmarcar; atualiza de verdade ao aplicar e recarregar). */
  totalAtual: number;
  onAplicar: (filtros: FiltrosAplicados) => void;
};

/** Marca de novo o que já estava marcado desmarca (R2b, item 2: "Fala" e "De onde" não têm opção "os dois" própria, é o estado sem nenhuma marca). */
function alternarUnico<T>(atual: T | undefined, valor: T): T | undefined {
  return atual === valor ? undefined : valor;
}

function OpcaoFiltro({
  rotulo,
  quantos,
  marcada,
  onClick,
}: {
  rotulo: string;
  quantos: number;
  marcada: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      onClick={onClick}
      className={[styles.opcao, marcada ? styles.marcada : ""].filter(Boolean).join(" ")}
    >
      <span>{rotulo}</span>
      <span className={styles.aoLado}>
        <span className={styles.quantos}>{quantos}</span>
        {marcada ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : null}
      </span>
    </button>
  );
}

/** Igual a `OpcaoFiltro`, sem o número ao lado: "Em que ordem" não tem contagem por opção (a ordem não muda quantos vídeos aparecem). */
function OpcaoFiltroSemContagem({ rotulo, marcada, onClick }: { rotulo: string; marcada: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      onClick={onClick}
      className={[styles.opcao, marcada ? styles.marcada : ""].filter(Boolean).join(" ")}
    >
      <span>{rotulo}</span>
      {marcada ? <Check size={16} strokeWidth={2} aria-hidden="true" className={styles.aoLado} /> : null}
    </button>
  );
}

/**
 * A folha "Filtrar" (V6, item 3; R2b, item 2, `Referencias.dc.html`,
 * `.folha-filtrar`): ordem, views, onde foi postado, tipo de vídeo (formato
 * mais meme/recorte), fala e de onde, todos valendo nos três segmentos.
 * Período e busca continuam na barra de cima, fora da folha, como já eram.
 * Estado local até "Ver os N vídeos" (que navega para a URL nova); "Limpar"
 * some com tudo, menos período e busca.
 *
 * `ReferenciasTela` só monta este componente com a folha aberta (V7, item 1
 * do PROXIMO.md): o estado local nasce da URL a cada abertura, em vez de
 * guardar marcas que a pessoa não aplicou. `aoFechar` é o `fechar` do
 * `useFolhaNoHistorico` de lá.
 */
export function FolhaFiltrarReferencias({
  aberto,
  aoFechar,
  plataformasAtivas,
  formatosAtivos,
  ordem,
  viewsMin,
  comFala,
  brasil,
  tiposConteudo,
  contagens,
  totalAtual,
  onAplicar,
}: Props) {
  const [plataformas, setPlataformas] = useState<Plataforma[]>(plataformasAtivas);
  const [formatos, setFormatos] = useState<AnaliseVideo["formato"][]>(formatosAtivos);
  const [ordemLocal, setOrdemLocal] = useState<OrdemReferencias>(ordem ?? "recentes");
  const [viewsMinLocal, setViewsMinLocal] = useState<number | undefined>(viewsMin);
  const [comFalaLocal, setComFalaLocal] = useState<boolean | undefined>(comFala);
  const [brasilLocal, setBrasilLocal] = useState<boolean | undefined>(brasil);
  const [tiposConteudoLocal, setTiposConteudoLocal] = useState<TipoConteudoFiltravel[]>(tiposConteudo);

  function alternarPlataforma(valor: Plataforma) {
    setPlataformas((atual) => (atual.includes(valor) ? atual.filter((p) => p !== valor) : [...atual, valor]));
  }
  function alternarFormato(valor: AnaliseVideo["formato"]) {
    setFormatos((atual) => (atual.includes(valor) ? atual.filter((f) => f !== valor) : [...atual, valor]));
  }
  function alternarTipoConteudo(valor: TipoConteudoFiltravel) {
    setTiposConteudoLocal((atual) => (atual.includes(valor) ? atual.filter((t) => t !== valor) : [...atual, valor]));
  }

  function aplicar() {
    onAplicar({
      plataformas,
      formatos,
      ordem: ordemLocal === "recentes" ? undefined : ordemLocal,
      viewsMin: viewsMinLocal,
      comFala: comFalaLocal,
      brasil: brasilLocal,
      tiposConteudo: tiposConteudoLocal,
    });
  }

  return (
    <Folha
      titulo={textosReferencias.folhaFiltrarTitulo}
      aberto={aberto}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className={styles.botaoAplicar} onClick={aplicar}>
            {textosReferencias.verVideos(totalAtual)}
          </button>
          <button
            type="button"
            className={styles.botaoLimpar}
            onClick={() =>
              onAplicar({
                plataformas: [],
                formatos: [],
                ordem: undefined,
                viewsMin: undefined,
                comFala: undefined,
                brasil: undefined,
                tiposConteudo: [],
              })
            }
          >
            {textosReferencias.limpar}
          </button>
        </>
      }
    >
      <div className={styles.grupo}>
        <span className={styles.rotuloGrupo}>{textosReferencias.emQueOrdem}</span>
        {ORDENS_EM_ORDEM.map((o) => (
          <OpcaoFiltroSemContagem
            key={o.valor}
            rotulo={o.rotulo}
            marcada={ordemLocal === o.valor}
            onClick={() => setOrdemLocal(o.valor)}
          />
        ))}
      </div>

      <div className={styles.grupo}>
        <span className={styles.rotuloGrupo}>{textosReferencias.views}</span>
        <OpcaoFiltro
          rotulo={textosReferencias.qualquerNumeroDeViews}
          quantos={contagens.porViewsMin.qualquer}
          marcada={viewsMinLocal === undefined}
          onClick={() => setViewsMinLocal(undefined)}
        />
        {textosReferencias.viewsFaixas.map((f) => (
          <OpcaoFiltro
            key={f.valor}
            rotulo={f.rotulo}
            quantos={
              f.valor === 10_000
                ? contagens.porViewsMin.dezMil
                : f.valor === 50_000
                  ? contagens.porViewsMin.cinquentaMil
                  : f.valor === 100_000
                    ? contagens.porViewsMin.cemMil
                    : contagens.porViewsMin.umMilhao
            }
            marcada={viewsMinLocal === f.valor}
            onClick={() => setViewsMinLocal(f.valor)}
          />
        ))}
      </div>

      <div className={styles.grupo}>
        <span className={styles.rotuloGrupo}>{textosReferencias.ondeFoiPostado}</span>
        {PLATAFORMAS_EM_ORDEM.map((p) => (
          <OpcaoFiltro
            key={p.valor}
            rotulo={p.rotulo}
            quantos={contagens.porPlataforma[p.valor]}
            marcada={plataformas.includes(p.valor)}
            onClick={() => alternarPlataforma(p.valor)}
          />
        ))}
      </div>

      <div className={styles.grupo}>
        <span className={styles.rotuloGrupo}>{textosReferencias.tipoDeVideo}</span>
        {FORMATOS_EM_ORDEM.map((f) => (
          <OpcaoFiltro
            key={f}
            rotulo={ROTULO_FORMATO[f]}
            quantos={contagens.porFormato[f]}
            marcada={formatos.includes(f)}
            onClick={() => alternarFormato(f)}
          />
        ))}
        {TIPOS_CONTEUDO_FILTRAVEIS_EM_ORDEM.map((t) => (
          <OpcaoFiltro
            key={t}
            rotulo={ROTULO_TIPO_CONTEUDO_FILTRAVEL[t]}
            quantos={contagens.porTipoConteudo[t]}
            marcada={tiposConteudoLocal.includes(t)}
            onClick={() => alternarTipoConteudo(t)}
          />
        ))}
      </div>

      <div className={styles.grupo}>
        <span className={styles.rotuloGrupo}>{textosReferencias.fala}</span>
        <OpcaoFiltro
          rotulo={textosReferencias.comFala}
          quantos={contagens.porFala.comFala}
          marcada={comFalaLocal === true}
          onClick={() => setComFalaLocal(alternarUnico(comFalaLocal, true))}
        />
        <OpcaoFiltro
          rotulo={textosReferencias.semFala}
          quantos={contagens.porFala.semFala}
          marcada={comFalaLocal === false}
          onClick={() => setComFalaLocal(alternarUnico(comFalaLocal, false))}
        />
      </div>

      <div className={styles.grupo}>
        <span className={styles.rotuloGrupo}>{textosReferencias.deOnde}</span>
        <OpcaoFiltro
          rotulo={textosReferencias.doBrasil}
          quantos={contagens.porBrasil.brasil}
          marcada={brasilLocal === true}
          onClick={() => setBrasilLocal(alternarUnico(brasilLocal, true))}
        />
        <OpcaoFiltro
          rotulo={textosReferencias.deFora}
          quantos={contagens.porBrasil.fora}
          marcada={brasilLocal === false}
          onClick={() => setBrasilLocal(alternarUnico(brasilLocal, false))}
        />
      </div>
    </Folha>
  );
}
