"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";

import { textosNav } from "@/textos/nav";
import { textosPlanejamento } from "@/textos/planejamento";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { useConexao } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";
import { useJaEstavaEmDia } from "@/ui/useJaEstavaEmDia";

import { SeletorMarcaCelular, type MarcaResumo } from "../../_casca/SeletorMarcaCelular";
import { useTrocaMarca } from "../../_casca/TrocaMarcaContext";
import { FolhaPlanejarDias } from "../hoje/FolhaPlanejarDias";
import { HojeCabecalho } from "../hoje/HojeCabecalho";
import styles from "../hoje/HojeTela.module.css";

import { CabecaPlano, type Visao } from "./CabecaPlano";

export type PropsCabecaPlano = {
  rotuloPeriodo: string;
  tituloPeriodo: string;
  tituloPeriodoCurto?: string;
  mostrarHoje: boolean;
  hrefAnterior: string;
  hrefSeguinte: string;
  hrefHoje: string;
  hrefPorVisao: Record<Visao, string>;
};

type Props = {
  visao: Visao;
  cabeca: PropsCabecaPlano;
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
  children: ReactNode;
};

/**
 * `page.tsx` é Server Component; uma função não atravessa para um Client Component como prop
 * (não serializa na carga do RSC). O abridor de "Contar a minha agenda" vem por Contexto, não por
 * `children` de função: `useAbrirContarAgenda()` para quem precisar do botão no próprio pé.
 */
const ContextoContarAgenda = createContext<() => void>(() => {});
export function useAbrirContarAgenda(): () => void {
  return useContext(ContextoContarAgenda);
}

/**
 * `/planejamento` (passo 12 do Opus, aba própria desde a decisão do Gustavo de 01/10, 22:15): a
 * casca compartilhada pelas três visões (Dia, Semana, Mês). `BarraTopo` (o título da tela, o
 * seletor de marca, atualizar) e `CabecaPlano` (o cabeçalho do período) moram aqui, uma vez só;
 * cada visão entra só com o próprio miolo, sem repetir nenhum dos dois. Reusa o layout de
 * `../hoje/HojeTela.module.css` (`.pagina`/`.miolo`/`.botaoBarra`), que é genérico, não preso à
 * aba Hoje. "Contar a minha agenda" é uma folha só, aberta tanto pelo botão do cabeçalho
 * (tablet para cima) quanto pelo do pé de cada visão (celular, via `useAbrirContarAgenda`).
 */
export function PlanejadorTela({ visao, cabeca, marcaAtiva, marcas, nomePessoa, children }: Props) {
  const router = useRouter();
  const { trocando, marcaAlvo } = useTrocaMarca();
  const { avisarFalhaDeRede } = useConexao();
  const [ocupado, iniciarTransicao] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);
  const atualizando = ocupado && acao === "atualizar";
  const emDia = useJaEstavaEmDia(atualizando);

  function atualizar() {
    if (ocupado) return;
    if (!navigator.onLine) {
      avisarFalhaDeRede();
      return;
    }
    setAcao("atualizar");
    iniciarTransicao(() => router.refresh());
  }

  const [folhaPlanejarAberta, setFolhaPlanejarAberta] = useState(false);
  const { fechar: fecharFolhaPlanejar } = useFolhaNoHistorico(folhaPlanejarAberta, () => setFolhaPlanejarAberta(false));
  function abrirContarAgenda() {
    setFolhaPlanejarAberta(true);
  }

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={textosPlanejamento.titulo}
        direita={
          <>
            <SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
            <button
              type="button"
              className={styles.botaoBarra}
              aria-label={textosNav.atualizar}
              aria-busy={atualizando || undefined}
              disabled={ocupado}
              onClick={atualizar}
            >
              <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" className={atualizando ? styles.girando : undefined} />
              {marcas.length <= 1 || emDia ? <span>{emDia ? textosNav.jaEstavaEmDia : textosNav.atualizar}</span> : null}
            </button>
            {/* A região viva fica FORA do botão (dentro dele o leitor de tela a lê como parte do nome) e existe desde o começo: só o texto muda. */}
            <span className="so-leitor" role="status" aria-live="polite">
              {emDia ? textosNav.jaEstavaEmDia : ""}
            </span>
          </>
        }
      />

      {trocando ? (
        <div className={styles.miolo}>
          <HojeCabecalho estado="trocando" mensagemTrocando={textosNav.abrindoMarca(marcaAlvo ?? "")} />
        </div>
      ) : (
        <div className={styles.miolo}>
          <CabecaPlano visao={visao} {...cabeca} aoAbrirContarAgenda={abrirContarAgenda} />
          <ContextoContarAgenda.Provider value={abrirContarAgenda}>{children}</ContextoContarAgenda.Provider>
        </div>
      )}

      {folhaPlanejarAberta ? <FolhaPlanejarDias aoFechar={fecharFolhaPlanejar} /> : null}
    </div>
  );
}
