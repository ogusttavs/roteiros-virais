"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import type { AnaliseVideo, Plataforma } from "@/db/schema";
import { FORMATOS_EM_ORDEM, ROTULO_FORMATO } from "@/ia/enums";
import type { ContagensFiltroReferencias } from "@/servicos/pesquisa";
import { textosReferencias } from "@/textos/referencias";
import { Folha } from "@/ui/componentes/Folha";

import styles from "./FolhaFiltrarReferencias.module.css";

const PLATAFORMAS_EM_ORDEM: { valor: Plataforma; rotulo: string }[] = [
  { valor: "tiktok", rotulo: "TikTok" },
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "youtube", rotulo: "YouTube" },
];

type Props = {
  aberto: boolean;
  aoFechar: () => void;
  plataformasAtivas: Plataforma[];
  formatosAtivos: AnaliseVideo["formato"][];
  contagens: ContagensFiltroReferencias;
  /** O total já carregado (não recalcula ao marcar/desmarcar; atualiza de verdade ao aplicar e recarregar). */
  totalAtual: number;
  onAplicar: (filtros: { plataformas: Plataforma[]; formatos: AnaliseVideo["formato"][] }) => void;
};

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

/**
 * A folha "Filtrar" (V6, item 3, `Referencias.dc.html`, `.folha-filtrar`):
 * "Onde foi postado" e "Formato" nesta parte (3a); "Só fora da curva" e
 * "Views acima de" só fazem sentido no segmento "Todos" e ficam para a
 * parte 3b. Estado local até "Ver os N vídeos" (que navega para a URL
 * nova); "Limpar" some com plataforma e formato, mantém período e busca.
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
  contagens,
  totalAtual,
  onAplicar,
}: Props) {
  const [plataformas, setPlataformas] = useState<Plataforma[]>(plataformasAtivas);
  const [formatos, setFormatos] = useState<AnaliseVideo["formato"][]>(formatosAtivos);

  function alternarPlataforma(valor: Plataforma) {
    setPlataformas((atual) => (atual.includes(valor) ? atual.filter((p) => p !== valor) : [...atual, valor]));
  }
  function alternarFormato(valor: AnaliseVideo["formato"]) {
    setFormatos((atual) => (atual.includes(valor) ? atual.filter((f) => f !== valor) : [...atual, valor]));
  }

  return (
    <Folha
      titulo={textosReferencias.folhaFiltrarTitulo}
      aberto={aberto}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className={styles.botaoAplicar} onClick={() => onAplicar({ plataformas, formatos })}>
            {textosReferencias.verVideos(totalAtual)}
          </button>
          <button
            type="button"
            className={styles.botaoLimpar}
            onClick={() => onAplicar({ plataformas: [], formatos: [] })}
          >
            {textosReferencias.limpar}
          </button>
        </>
      }
    >
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
        <span className={styles.rotuloGrupo}>{textosReferencias.formato}</span>
        {FORMATOS_EM_ORDEM.map((f) => (
          <OpcaoFiltro
            key={f}
            rotulo={ROTULO_FORMATO[f]}
            quantos={contagens.porFormato[f]}
            marcada={formatos.includes(f)}
            onClick={() => alternarFormato(f)}
          />
        ))}
      </div>
    </Folha>
  );
}
