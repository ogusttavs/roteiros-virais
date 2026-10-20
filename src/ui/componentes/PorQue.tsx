"use client";

import { ChevronDown } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { temPorQue, textosDoPorQue, type PorQueDoBloco } from "@/lib/por-que-do-bloco";
import { textosRoteiro } from "@/textos/roteiro";

import styles from "./PorQue.module.css";

/** O vídeo do banco que um "por quê" cita: o link (só https) e o que a pessoa lê sobre ele. */
export type VideoDoPorQue = { url: string | null; conta: string | null; vezes: number | null };

type Contexto = {
  itens: Map<string, PorQueDoBloco>;
  videos: Record<number, VideoDoPorQue>;
  todosAbertos: boolean;
  abertos: Set<string>;
  alternar: (id: string) => void;
  alternarTodos: () => void;
  existe: boolean;
};

const PorQueContexto = createContext<Contexto | null>(null);

function formatarSegundo(segundo: number): string {
  const minutos = Math.floor(segundo / 60);
  return `${minutos}:${String(Math.floor(segundo % 60)).padStart(2, "0")}`;
}

/**
 * O "Por quê" de cada bloco do roteiro (E50 parte 2, PR 4; design v2, passo 24). Fechado, só a palavra, ao lado do tempo do bloco; aberto, "O que faz", "Com base em" (o vídeo do banco com o link
 * no segundo certo, ou a regra pelo nome que a pessoa entende) e "Para". "Ver os porquês", no alto do roteiro, abre todos. Roteiro antigo, sem `porQueDosBlocos`, não mostra a palavra.
 */
export function PorQuesProvider({ itens, videos = {}, children }: { itens: PorQueDoBloco[] | undefined; videos?: Record<number, VideoDoPorQue>; children: ReactNode }) {
  const [todosAbertos, setTodosAbertos] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const mapa = useMemo(() => new Map((itens ?? []).filter((i) => temPorQue(i)).map((i) => [i.bloco, i])), [itens]);
  const alternar = useCallback((id: string) => {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }, []);
  const alternarTodos = useCallback(() => {
    setTodosAbertos((atual) => !atual);
    setAbertos(new Set());
  }, []);
  const valor = useMemo<Contexto>(
    () => ({ itens: mapa, videos, todosAbertos, abertos, alternar, alternarTodos, existe: mapa.size > 0 }),
    [mapa, videos, todosAbertos, abertos, alternar, alternarTodos],
  );
  return <PorQueContexto.Provider value={valor}>{children}</PorQueContexto.Provider>;
}

function usePorQues(): Contexto | null {
  return useContext(PorQueContexto);
}

function chavesComPorQue(contexto: Contexto | null, chaves: string[]): string[] {
  return contexto ? chaves.filter((c) => contexto.itens.has(c)) : [];
}

/** "Ver os porquês" / "Fechar os porquês", no alto do roteiro; não aparece sem nenhum por quê. */
export function VerOsPorques({ className }: { className?: string }) {
  const contexto = usePorQues();
  if (!contexto?.existe) return null;
  return (
    <button type="button" className={[styles.verTodos, className].filter(Boolean).join(" ")} onClick={contexto.alternarTodos} aria-pressed={contexto.todosAbertos} data-ver-os-porques="">
      {contexto.todosAbertos ? textosRoteiro.porQue.fecharOsPorques : textosRoteiro.porQue.verOsPorques}
    </button>
  );
}

/** A palavra "Por quê" ao lado do tempo do bloco; abre e fecha o painel que `PorQueAberto` desenha (mesmo `id`). */
export function PorQueBotao({ chaves, id, rotuloDoBloco }: { chaves: string[]; id: string; rotuloDoBloco: string }) {
  const contexto = usePorQues();
  const visiveis = chavesComPorQue(contexto, chaves);
  if (!contexto || visiveis.length === 0) return null;
  const aberto = contexto.todosAbertos || contexto.abertos.has(id);
  return (
    <button
      type="button"
      className={styles.botao}
      aria-expanded={aberto}
      aria-controls={id}
      aria-label={textosRoteiro.porQue.botaoAria(rotuloDoBloco)}
      onClick={() => contexto.alternar(id)}
      data-porque-botao={id}
    >
      {textosRoteiro.porQue.botao}
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

function Painel({ item, contexto }: { item: PorQueDoBloco; contexto: Contexto }) {
  const t = textosDoPorQue(item);
  const video = t.comBaseEm?.tipo === "video" ? contexto.videos[t.comBaseEm.videoId] : undefined;
  return (
    <>
      {t.oQueFaz ? (
        <p>
          <b>{textosRoteiro.porQue.oQueFaz}</b> {t.oQueFaz}
        </p>
      ) : null}
      {t.comBaseEm ? (
        <p>
          <b>{textosRoteiro.porQue.comBaseEm}</b>{" "}
          {t.comBaseEm.tipo === "video" ? (video ? textosRoteiro.porQue.doVideo(video.conta, video.vezes) : "") : t.comBaseEm.texto}
        </p>
      ) : null}
      {t.comBaseEm?.tipo === "video" && video?.url ? (
        <a href={video.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          {textosRoteiro.porQue.verOVideo(formatarSegundo(t.comBaseEm.segundo))}
        </a>
      ) : null}
      {t.para ? (
        <p>
          <b>{textosRoteiro.porQue.para}</b> {t.para}
        </p>
      ) : null}
    </>
  );
}

/** O painel aberto, logo depois do texto do bloco. Com mais de uma chave (as frases na tela), uma seção por frase. */
export function PorQueAberto({ chaves, id }: { chaves: string[]; id: string }) {
  const contexto = usePorQues();
  const visiveis = chavesComPorQue(contexto, chaves);
  if (!contexto || visiveis.length === 0) return null;
  const aberto = contexto.todosAbertos || contexto.abertos.has(id);
  if (!aberto) return null;
  return (
    <div className={styles.aberto} id={id} data-porque-aberto={id}>
      {visiveis.map((chave, i) => {
        const item = contexto.itens.get(chave)!;
        return (
          <div key={chave} className={styles.secao}>
            {visiveis.length > 1 ? <span className={styles.frase}>{textosRoteiro.porQue.fraseNaTela(i + 1)}</span> : null}
            <Painel item={item} contexto={contexto} />
          </div>
        );
      })}
    </div>
  );
}
