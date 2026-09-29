import { textosHoje } from "@/textos/hoje";

import styles from "./HojeTela.module.css";

const DATA_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function dataDeHojePorExtenso(): string {
  const texto = DATA_POR_EXTENSO.format(new Date());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

type Estado = "normal" | "carregando" | "vazio" | "erro" | "trocando";

/**
 * Data, título e uma linha de estado no topo de `/hoje`, em todo estado
 * (design v2, `entrega/telas/Hoje.dc.html`, `.cabecalho-tela`). Server
 * Component puro, para `page.tsx`, `loading.tsx` e `error.tsx` usarem sem
 * precisar de `"use client"`.
 *
 * V12, item 1: a linha de constância ("você gravou N dos últimos 7 dias")
 * saiu daqui e foi para o cartão "Sua semana" no topo da tela (`HojeTela.tsx`,
 * `AparteSemanaTopo`), junto dos três estados do dia; este cabeçalho, no
 * estado "normal", agora só data, título e o aviso de vídeo subindo.
 *
 * `avisoVideoSubindo` (etapa 15, parte 1, decisão 4): uma linha curta
 * quando algum vídeo postado está acima do normal da própria conta, só no
 * estado normal, já formatada por quem chama.
 *
 * `mensagemTrocando` (V3, item 3, estado `trocando` de `Casca.dc.html`): a
 * troca de marca diz o nome da marca que está chegando ("Abrindo <marca>"),
 * não "carregando"; só faz sentido junto de `estado="trocando"`, calculada
 * por quem chama (`HojeTela.tsx`) porque só ela sabe o nome da marca alvo.
 */
export function HojeCabecalho({
  avisoVideoSubindo = null,
  estado = "normal",
  mensagemTrocando,
}: {
  avisoVideoSubindo?: string | null;
  estado?: Estado;
  mensagemTrocando?: string;
}) {
  return (
    <div className={styles.cabecalhoTela}>
      <span className={styles.data}>{dataDeHojePorExtenso()}</span>
      <h1>{textosHoje.titulo}</h1>
      {estado === "carregando" ? (
        <p className={styles.fraseEstado}>{textosHoje.carregando}</p>
      ) : estado === "vazio" ? (
        <p className={styles.fraseEstado}>{textosHoje.vazioTitulo}</p>
      ) : estado === "trocando" ? (
        <p className={styles.fraseEstado} role="status">
          {mensagemTrocando}
        </p>
      ) : estado === "erro" ? (
        <p className={styles.fraseEstado}>{textosHoje.erroAviso}</p>
      ) : null}
      {estado === "normal" && avisoVideoSubindo ? <p className={styles.avisoVideo}>{avisoVideoSubindo}</p> : null}
    </div>
  );
}
