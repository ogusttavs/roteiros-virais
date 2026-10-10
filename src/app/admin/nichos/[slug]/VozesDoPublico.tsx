import { MessageCircle } from "lucide-react";
import Link from "next/link";

import type { Plataforma } from "@/db/schema";
import { POR_TIPO_NO_SETOR } from "@/servicos/comentarios-do-publico";
import { diaPorExtenso, enderecoHttpsSeguro } from "@/servicos/noticias-assuntos";
import { listaDePlataformas, type VozDoAdmin } from "@/servicos/vozes-do-publico";
import { textosAdmin } from "@/textos/admin";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import styles from "./page.module.css";

const t = textosAdmin.nichoDetalhe.vozes;

/** Quantos vídeos de onde a voz veio têm link na linha (o resto fica no "em N vídeos"). */
const LINKS_POR_LINHA = 3;

/** Quantas linhas cada lista mostra: o que o job guarda por setor (a mesma constante dele, para a seção nunca esconder em silêncio o que o job passar a guardar). */
const LIMITES = { duvidas: POR_TIPO_NO_SETOR.duvida, objecoes: POR_TIPO_NO_SETOR.objecao, pedidos: POR_TIPO_NO_SETOR.pedido } as const;

export type VideoLinkavelDaVoz = { titulo: string | null; url: string };

type Listas = { duvidas: VozDoAdmin[]; objecoes: VozDoAdmin[]; pedidos: VozDoAdmin[] };

type Props = Listas & {
  /** Nulo quando o setor nunca teve leitura. */
  leitura: { comentarios: number; videos: number; plataformas: Plataforma[]; lidaEm: Date } | null;
  /** A leitura ainda dentro dos dias de validade (a que alimenta os temas e o roteiro). */
  vale: boolean;
  validaAte: Date | null;
  piso: number;
  videos: Map<number, VideoLinkavelDaVoz>;
};

function Lista({
  id,
  titulo,
  itens,
  limite,
  piso,
  vale,
  videos,
}: {
  id: string;
  titulo: string;
  itens: VozDoAdmin[];
  limite: number;
  piso: number;
  vale: boolean;
  videos: Map<number, VideoLinkavelDaVoz>;
}) {
  const mostradas = itens.slice(0, limite);
  return (
    <div className={styles.secao} data-vozes-lista={titulo}>
      <div className={styles.tituloComContagem}>
        <h3 id={id}>{titulo}</h3>
        <span className={styles.contagem}>{itens.length > mostradas.length ? t.mostrando(mostradas.length, itens.length) : itens.length}</span>
      </div>
      {mostradas.length === 0 ? (
        <p className={styles.contagem}>{t.nenhumaNaLista}</p>
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={`${styles.tabela} ${styles.tabelaVozes}`} aria-labelledby={id}>
            <thead>
              <tr>
                <th>{t.colunaTexto}</th>
                <th>{t.colunaComentarios}</th>
                <th>{t.colunaPlataforma}</th>
                <th>{t.colunaVideos}</th>
                <th>{t.colunaSituacao}</th>
              </tr>
            </thead>
            <tbody>
              {mostradas.map((voz) => (
                <tr key={voz.chave} data-voz-passou-do-piso={voz.passouDoPiso ? "sim" : "nao"}>
                  <td>{voz.texto}</td>
                  <td className={styles.mono}>{voz.vezes}</td>
                  <td>{listaDePlataformas(voz.plataformas) || t.semPlataforma}</td>
                  <td>
                    {t.emVideos(voz.videos.length)}
                    {voz.videos.slice(0, LINKS_POR_LINHA).map((idDoVideo, i) => {
                      const video = videos.get(idDoVideo);
                      const endereco = video ? enderecoHttpsSeguro(video.url) : null;
                      if (!video || !endereco) return null;
                      return (
                        <span key={idDoVideo}>
                          {" "}
                          <Link href={endereco} target="_blank" rel="noopener noreferrer" aria-label={t.verVideoN(i + 1, video.titulo)}>
                            {i + 1}
                          </Link>
                        </span>
                      );
                    })}
                  </td>
                  <td className={voz.passouDoPiso && vale ? undefined : styles.aviso}>
                    {!voz.passouDoPiso ? t.abaixoDoPiso(piso) : vale ? t.passouDoPiso : t.passouComLeituraVelha}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * E28, parte 4: "Vozes do público" no admin do setor (desenho do passo 25, `AdminNicho`): o que o público do setor disse nos comentários dos vídeos mais vistos da semana, com de quando é a
 * leitura e se ainda vale, e o que ficou abaixo do piso (que a tela e os prompts não usam). Só leitura: a rotina é a semanal, em Rotinas.
 */
export function VozesDoPublico({ duvidas, objecoes, pedidos, leitura, vale, validaAte, piso, videos }: Props) {
  const total = duvidas.length + objecoes.length + pedidos.length;
  const frase = leitura ? t.leitura(leitura.comentarios, leitura.videos, listaDePlataformas(leitura.plataformas) || "YouTube", diaPorExtenso(leitura.lidaEm)) : null;
  // "sem": o setor nunca teve leitura; "vazia": a rotina rodou e não juntou nenhuma voz; "vale" e "velha": há vozes, e a leitura ainda vale ou já passou.
  const situacao = !leitura ? "sem" : total === 0 ? "vazia" : vale ? "vale" : "velha";
  return (
    <section className={styles.secao} aria-labelledby="t-vozes-do-publico" data-vozes-do-publico={situacao}>
      <div className={styles.tituloComContagem}>
        <h2 id="t-vozes-do-publico">{t.titulo}</h2>
        <span className={styles.contagem}>{total}</span>
      </div>
      {!leitura || total === 0 ? (
        <>
          {frase ? (
            <p className={styles.contagem} data-vozes-leitura>
              {frase}
            </p>
          ) : null}
          <EstadoVazio icone={<MessageCircle size={24} strokeWidth={1.5} aria-hidden="true" />} frase={leitura ? t.vazioComLeitura : t.vazio} />
        </>
      ) : (
        <>
          <p className={styles.contagem} data-vozes-leitura>
            {frase}
          </p>
          <p className={vale ? styles.contagem : styles.aviso} data-vozes-validade>
            {vale && validaAte ? t.aindaVale(diaPorExtenso(validaAte)) : t.velha(diaPorExtenso(leitura.lidaEm))}
          </p>
          <Lista id="t-vozes-duvidas" titulo={t.duvidasTitulo} itens={duvidas} limite={LIMITES.duvidas} piso={piso} vale={vale} videos={videos} />
          <Lista id="t-vozes-objecoes" titulo={t.objecoesTitulo} itens={objecoes} limite={LIMITES.objecoes} piso={piso} vale={vale} videos={videos} />
          <Lista id="t-vozes-pedidos" titulo={t.pedidosTitulo} itens={pedidos} limite={LIMITES.pedidos} piso={piso} vale={vale} videos={videos} />
          <p className={styles.contagem}>{t.ajuda}</p>
        </>
      )}
    </section>
  );
}

/** Os ids de vídeo que a seção linka: os primeiros de cada linha mostrada (para a página buscar título e endereço de uma vez), sem repetir. */
export function idsDeVideoDasVozes({ duvidas, objecoes, pedidos }: Listas): number[] {
  const ids = new Set<number>();
  for (const [lista, limite] of [
    [duvidas, LIMITES.duvidas],
    [objecoes, LIMITES.objecoes],
    [pedidos, LIMITES.pedidos],
  ] as const) {
    for (const voz of lista.slice(0, limite)) for (const id of voz.videos.slice(0, LINKS_POR_LINHA)) ids.add(id);
  }
  return [...ids];
}
