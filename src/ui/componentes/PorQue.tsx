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
  /** Com "Ver os porquês" ligado, os blocos que a pessoa fechou um a um. */
  fechados: Set<string>;
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
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const mapa = useMemo(() => new Map((itens ?? []).filter((i) => temPorQue(i)).map((i) => [i.bloco, i])), [itens]);
  const trocar = (conjunto: Set<string>, id: string) => {
    const novo = new Set(conjunto);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    return novo;
  };
  // Com "Ver os porquês" ligado, o botão de um bloco o fecha (e abre de novo); sem ele, abre e fecha só aquele bloco.
  const alternar = useCallback(
    (id: string) => {
      if (todosAbertos) setFechados((atual) => trocar(atual, id));
      else setAbertos((atual) => trocar(atual, id));
    },
    [todosAbertos],
  );
  const alternarTodos = useCallback(() => {
    setTodosAbertos((atual) => !atual);
    setAbertos(new Set());
    setFechados(new Set());
  }, []);
  const valor = useMemo<Contexto>(
    () => ({ itens: mapa, videos, todosAbertos, abertos, fechados, alternar, alternarTodos, existe: mapa.size > 0 }),
    [mapa, videos, todosAbertos, abertos, fechados, alternar, alternarTodos],
  );
  return <PorQueContexto.Provider value={valor}>{children}</PorQueContexto.Provider>;
}

function usePorQues(): Contexto | null {
  return useContext(PorQueContexto);
}

function estaAberto(contexto: Contexto, id: string): boolean {
  return contexto.todosAbertos ? !contexto.fechados.has(id) : contexto.abertos.has(id);
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
  const aberto = estaAberto(contexto, id);
  return (
    <button
      type="button"
      className={styles.botao}
      aria-expanded={aberto}
      aria-controls={aberto ? id : undefined}
      aria-label={textosRoteiro.porQue.botaoAria(rotuloDoBloco)}
      onClick={() => contexto.alternar(id)}
      data-porque-botao={id}
    >
      {textosRoteiro.porQue.botao}
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/** O endereço do vídeo no segundo certo, quando a rede deixa (YouTube: `t=`); nas outras o link abre o vídeo e o texto não promete o segundo. */
export function enderecoNoSegundo(url: string, segundo: number): { href: string; comSegundo: boolean } {
  try {
    const u = new URL(url);
    const ehYoutube = u.hostname === "youtu.be" || u.hostname.endsWith("youtube.com");
    if (ehYoutube && segundo > 0) {
      u.searchParams.set("t", `${Math.floor(segundo)}s`);
      return { href: u.toString(), comSegundo: true };
    }
  } catch {
    // endereço que não lê: segue como veio
  }
  return { href: url, comSegundo: false };
}

function LinkDoVideo({ url, segundo }: { url: string; segundo: number }) {
  const { href, comSegundo } = enderecoNoSegundo(url, segundo);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      {comSegundo ? textosRoteiro.porQue.verOVideo(formatarSegundo(segundo)) : textosRoteiro.porQue.verOVideoSimples}
    </a>
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
      {t.comBaseEm && (t.comBaseEm.tipo === "regra" || video) ? (
        <p>
          <b>{textosRoteiro.porQue.comBaseEm}</b>{" "}
          {t.comBaseEm.tipo === "video" ? textosRoteiro.porQue.doVideo(video?.conta ?? null, video?.vezes ?? null) : t.comBaseEm.texto}
        </p>
      ) : null}
      {t.comBaseEm?.tipo === "video" && video?.url ? <LinkDoVideo url={video.url} segundo={t.comBaseEm.segundo} /> : null}
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
  if (!estaAberto(contexto, id)) return null;
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
