"use client";

import { Clock, Info, Plus, Search } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import type { Profundidade , DadosDoCampoDePesquisa } from "@/servicos/pesquisa-na-hora";
import { textosPesquisa } from "@/textos/pesquisa";

import { CampoComFala } from "./CampoComFala";
import styles from "./CampoPesquisar.module.css";


type Props = {
  dados: DadosDoCampoDePesquisa;
  aberto: boolean;
  aoAbrir: () => void;
  aoTirar: () => void;
  pedido: string;
  aoMudarPedido: (valor: string) => void;
  profundidade: Profundidade;
  aoMudarProfundidade: (valor: Profundidade) => void;
  /** A frase de quando o pedido não passou (curto demais, não conseguiu começar): erro do campo. */
  erro?: string | null;
  /** O teto do dia que o servidor acabou de dizer (os dados da página estavam velhos): um aviso calmo, nunca erro do campo. */
  aviso?: string | null;
  /** Para a tela dizer qual campo é este nos testes e nas capturas. */
  nomeArquivo?: string;
  disabled?: boolean;
};

const t = textosPesquisa.campo;

/**
 * "Pesquisar antes de escrever" (E54, parte 3; passo 22 do Opus: `.pesquisar-fechado`, `.pesquisar-antes`, `.custo-pesquisa`): a linha tracejada que não pesa, o pedido em texto
 * livre (falado ou escrito), "Rápida" ou "Mais a fundo" e o que isso custa em língua de gente (tempo, reais e quantas das pesquisas do dia). Os mesmos três lugares: o Tema livre,
 * "Contar o momento" e o "Gravar agora". Sem saldo no dia, vira um aviso calmo (nunca erro) e some o campo.
 */
export function CampoPesquisar({ dados, aberto, aoAbrir, aoTirar, pedido, aoMudarPedido, profundidade, aoMudarProfundidade, erro, aviso, nomeArquivo = "pesquisar-antes", disabled }: Props) {
  const idTitulo = useId();
  // Abrir o campo leva o foco para o pedido (o botão que a pessoa tocou some): quem usa teclado ou leitor de tela continua de onde estava.
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const jaMontou = useRef(false);
  useEffect(() => {
    if (aberto && jaMontou.current) campoRef.current?.focus();
    jaMontou.current = true;
  }, [aberto]);
  const restantes = Math.max(0, dados.teto - dados.usadasHoje);

  if (restantes === 0) {
    return (
      <section className={[styles.cartao, styles.aberto].join(" ")} aria-labelledby={idTitulo} data-pesquisar="sem-saldo">
        <div className={styles.topo}>
          <h3 id={idTitulo}>
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            {t.titulo}
          </h3>
        </div>
        <p className={styles.custo}>
          <Info size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <b>{t.semSaldo(dados.teto)}</b> {t.semSaldoDepois}
          </span>
        </p>
      </section>
    );
  }

  if (!aberto) {
    return (
      <button type="button" className={styles.fechado} aria-expanded="false" onClick={aoAbrir} disabled={disabled} data-pesquisar="fechado">
        <Search size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.oQue}>
          <b>{t.titulo}</b>
          <span>{t.subtitulo}</span>
        </span>
        <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  }

  const soRapida = restantes < 2;
  return (
    <section className={[styles.cartao, styles.aberto].join(" ")} aria-labelledby={idTitulo} data-pesquisar="aberto">
      <div className={styles.topo}>
        <h3 id={idTitulo}>
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          {t.titulo}
        </h3>
        <button type="button" className={styles.tirar} onClick={aoTirar} disabled={disabled}>
          {t.tirar}
        </button>
      </div>
      <p className={styles.ajuda}>{t.ajuda}</p>
      <CampoComFala
        rotulo={t.rotulo}
        rotuloOculto
        value={pedido}
        onChange={aoMudarPedido}
        placeholder={t.placeholder}
        maxLength={300}
        linhasMin={2}
        nomeArquivo={nomeArquivo}
        erro={erro ?? undefined}
        disabled={disabled}
        ref={campoRef}
      />
      <div className={styles.chips} role="radiogroup" aria-label={t.quantoPesquisar}>
        <button type="button" role="radio" aria-checked={profundidade === "normal"} className={styles.chip} onClick={() => aoMudarProfundidade("normal")} disabled={disabled}>
          {t.rapida}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={profundidade === "aprofundada"}
          className={styles.chip}
          onClick={() => aoMudarProfundidade("aprofundada")}
          disabled={disabled || soRapida}
        >
          {t.aFundo}
        </button>
      </div>
      <p className={styles.custo}>
        <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{soRapida ? t.soRapida(dados.rapida) : t.custo(dados.rapida, dados.aFundo, dados.teto, restantes)}</span>
      </p>
      {aviso ? (
        <p className={styles.custo} role="status" data-aviso-do-campo>
          <Info size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{aviso}</span>
        </p>
      ) : null}
    </section>
  );
}
