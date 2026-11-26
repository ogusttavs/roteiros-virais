import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { trechosDaFala, type TrechoDaFala } from "@/lib/marcas-de-fala";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

import { intervalosDeColchetes, PedacoComColchetes } from "./Colchetes";
import styles from "./FalaMarcada.module.css";

const ROTULOS = textosMarcasDeFala.rotulosDasMarcas;

/** A pausa desenhada (curta ou longa): uma barra, sem texto. */
export function MarcaDePausa({ duracao }: { duracao: "curta" | "longa" }) {
  return (
    <i
      role="img"
      aria-label={duracao === "longa" ? ROTULOS.pausaLonga : ROTULOS.pausaCurta}
      className={[styles.pausa, duracao === "longa" ? styles.pausaLonga : ""].filter(Boolean).join(" ")}
    />
  );
}

/** O tom desenhado: a seta que desce ou que sobe, no fim da frase. */
export function MarcaDeTom({ direcao }: { direcao: "desce" | "sobe" }) {
  const Seta = direcao === "desce" ? ArrowDownRight : ArrowUpRight;
  return (
    <span role="img" aria-label={direcao === "desce" ? ROTULOS.tomDesce : ROTULOS.tomSobe} className={styles.tom}>
      <Seta size="1em" strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}

/** A palavra de peso desenhada. */
export function MarcaDePeso({ children }: { children: ReactNode }) {
  return <b className={styles.peso}>{children}</b>;
}

/** O trecho dito devagar desenhado. */
export function MarcaDeDevagar({ children }: { children: ReactNode }) {
  return <span className={styles.devagar}>{children}</span>;
}

type Props = {
  /** O texto marcado de um parágrafo (`{p:}`, `{d:}`, `{/}`, `{//}`, `{v}` e `{^}`, `lib/marcas-de-fala.ts`). */
  marcado: string;
  /** 26/11/2026: destaca os trechos entre colchetes (o espaço para completar) na leitura do roteiro e no modo gravação. O PDF não liga. */
  comColchetes?: boolean;
};

/** O texto que o trecho põe na fala (a pausa e o tom não põem nenhum). */
function textoDoTrecho(trecho: TrechoDaFala): string {
  return trecho.tipo === "texto" || trecho.tipo === "peso" || trecho.tipo === "devagar" ? trecho.texto : "";
}

/** Desenha o texto de um pedaço que começa na posição `inicio` da fala (com os colchetes destacados, se houver). */
type Pintar = (texto: string, inicio: number, chave: string) => ReactNode;

function desenhar(trecho: TrechoDaFala, chave: string, inicio: number, pintar: Pintar) {
  switch (trecho.tipo) {
    case "texto":
      return pintar(trecho.texto, inicio, chave);
    case "peso":
      return <MarcaDePeso key={chave}>{pintar(trecho.texto, inicio, `${chave}-t`)}</MarcaDePeso>;
    case "devagar":
      return <MarcaDeDevagar key={chave}>{pintar(trecho.texto, inicio, `${chave}-t`)}</MarcaDeDevagar>;
    case "pausa":
      return <MarcaDePausa key={chave} duracao={trecho.duracao} />;
    case "tom":
      return <MarcaDeTom key={chave} direcao={trecho.direcao} />;
  }
}

/**
 * Um parágrafo de fala com as marcas desenhadas (E41 parte 2b; design v2, passo 24). Devolve só os filhos do parágrafo, para entrar no `<p>` de quem chama. O texto que sobra
 * (tirando as marcas, que são desenhos sem texto) é o do roteiro, com os mesmos espaços: o que a pessoa lê aqui é o que está escrito, e `textContent` prova isso nos testes.
 *
 * A pausa e o tom que vêm logo depois de uma palavra ficam grudados nela numa caixa que não quebra (`junto`): a seta ou a barra nunca vão sozinhas para o começo da linha de baixo.
 *
 * Com `comColchetes`, o trecho entre colchetes é achado no texto sem as marcas (a mesma regra do carrossel) e destacado mesmo quando uma marca cai no meio dele: cada pedaço desenhado
 * sabe em que posição da fala começa.
 */
export function FalaMarcada({ marcado, comColchetes = false }: Props) {
  const trechos = trechosDaFala(marcado);
  const inicios: number[] = [];
  let posicao = 0;
  for (const trecho of trechos) {
    inicios.push(posicao);
    posicao += textoDoTrecho(trecho).length;
  }
  const intervalos = comColchetes ? intervalosDeColchetes(trechos.map(textoDoTrecho).join("")) : [];
  const pintar: Pintar = (texto, inicio, chave) => (intervalos.length === 0 ? texto : <PedacoComColchetes key={chave} texto={texto} inicio={inicio} intervalos={intervalos} />);
  const nos: ReactNode[] = [];
  let i = 0;
  while (i < trechos.length) {
    const trecho = trechos[i];
    let fim = i + 1;
    while (fim < trechos.length && (trechos[fim].tipo === "pausa" || trechos[fim].tipo === "tom")) fim += 1;
    if (trecho.tipo === "pausa" || trecho.tipo === "tom") {
      // Uma marca sem palavra antes (o começo do parágrafo): fica solta.
      nos.push(desenhar(trecho, `t${i}`, inicios[i], pintar));
      i += 1;
      continue;
    }
    const marcas = trechos.slice(i + 1, fim);
    if (marcas.length === 0) {
      nos.push(desenhar(trecho, `t${i}`, inicios[i], pintar));
      i += 1;
      continue;
    }
    const desenhadas = marcas.map((m, k) => desenhar(m, `t${i}-${k}`, inicios[i + 1 + k], pintar));
    // Só a última palavra do trecho fica na caixa; o resto continua solto para a linha quebrar onde quiser (um trecho devagar de oito palavras não vira uma linha só).
    const texto = trecho.texto;
    const partes = /^([\s\S]*?)(\S*)$/.exec(texto);
    const cabeca = partes?.[1] ?? "";
    const ultima = partes?.[2] ?? "";
    if (ultima === "") {
      // O trecho termina em espaço: não há palavra para prender, as marcas ficam soltas.
      nos.push(desenhar(trecho, `t${i}`, inicios[i], pintar), ...desenhadas);
    } else if (trecho.tipo === "texto") {
      if (cabeca) nos.push(pintar(cabeca, inicios[i], `t${i}-c`));
      nos.push(
        <span key={`t${i}`} className={styles.junto}>
          {pintar(ultima, inicios[i] + cabeca.length, `t${i}-u`)}
          {desenhadas}
        </span>,
      );
    } else {
      const Marca = trecho.tipo === "peso" ? MarcaDePeso : MarcaDeDevagar;
      if (cabeca) nos.push(<Marca key={`t${i}-c`}>{pintar(cabeca, inicios[i], `t${i}-ct`)}</Marca>);
      nos.push(
        <span key={`t${i}`} className={styles.junto}>
          <Marca>{pintar(ultima, inicios[i] + cabeca.length, `t${i}-u`)}</Marca>
          {desenhadas}
        </span>,
      );
    }
    i = fim;
  }
  return <>{nos}</>;
}
