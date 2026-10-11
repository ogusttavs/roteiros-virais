import { Clapperboard } from "lucide-react";
import Link from "next/link";

import { enderecoHttpsSeguro } from "@/servicos/noticias-assuntos";
import type { MedidaDosLongos, VideoLongoDoSetor } from "@/servicos/videos-longos";
import { textosAdmin } from "@/textos/admin";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import styles from "./page.module.css";

const t = textosAdmin.nichoDetalhe.longos;

type Props = {
  /** A medida da janela larga (90 dias). */
  medida: MedidaDosLongos;
  /** Os longos da janela da lista (30 dias), os mais fora da curva primeiro, já cortados no que a seção mostra. */
  lista: VideoLongoDoSetor[];
  /** Quantos longos há na janela da lista, antes do corte. */
  totalNaLista: number;
  piso: number;
  lidosNaSemana: number;
  porSemana: number;
  /** O que é "longo", em segundos (acima do teto dos curtos e até o limite), e as duas janelas, em dias: o que a frase de "vazio" e a de medida dizem. */
  tetoS: number;
  maximoS: number;
  janelaDaListaDias: number;
  janelaDaMedidaDias: number;
};

const emMinutos = (s: number) => Math.max(1, Math.round(s / 60));

/**
 * E52 (PR 1): "Vídeos longos do YouTube" no admin do setor. Só leitura e só o que a coleta já traz (título, descrição, duração, visualizações): a duração e a estrutura típicas dos
 * longos do ramo, com o tamanho da amostra dito, e os longos da janela com a lista de capítulos que o dono escreveu. É a base do roteiro longo, e o lugar onde se vê, antes do
 * roteiro existir, se há amostra para sustentá-lo.
 */
export function VideosLongosDoSetor({ medida, lista, totalNaLista, piso, lidosNaSemana, porSemana, tetoS, maximoS, janelaDaListaDias, janelaDaMedidaDias }: Props) {
  const vazio = medida.amostra === 0 && lista.length === 0;
  return (
    <section className={styles.secao} aria-labelledby="t-longos-do-setor" data-longos-do-setor={medida.forca}>
      <div className={styles.tituloComContagem}>
        <h2 id="t-longos-do-setor">{t.titulo}</h2>
        <span className={styles.contagem}>{medida.amostra}</span>
      </div>
      {vazio ? (
        <EstadoVazio icone={<Clapperboard size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio(piso, emMinutos(tetoS), emMinutos(maximoS), janelaDaMedidaDias)} />
      ) : (
        <>
          <p className={styles.contagem} data-longos-medida>
            {t.medida(medida.amostra, janelaDaMedidaDias, piso)}: {t.forca[medida.forca]}
          </p>
          {medida.duracaoS ? (
            <p className={styles.contagem} data-longos-duracao>
              {t.duracao(emMinutos(medida.duracaoS.p25), emMinutos(medida.duracaoS.mediana), emMinutos(medida.duracaoS.p75))}
            </p>
          ) : null}
          {medida.amostra > 0 ? (
            <p className={styles.contagem} data-longos-brasileiros>
              {t.brasileiros(medida.brasileiros, medida.amostra, medida.duracaoS !== null)}
            </p>
          ) : null}
          <p className={styles.contagem} data-longos-estrutura>
            {medida.capitulos
              ? t.estrutura(medida.capitulos.videosComLista, medida.amostra, medida.capitulos.quantidadeMediana, emMinutos(medida.capitulos.tamanhoMedianoS), medida.capitulos.forca)
              : t.semEstrutura}
          </p>
          <p className={styles.contagem} data-longos-lidos>
            {t.lidos(lidosNaSemana, porSemana)}
          </p>

          {lista.length === 0 ? (
            <p className={styles.contagem}>{t.nenhumNaLista(janelaDaListaDias)}</p>
          ) : (
            <div className={styles.tabelaEnvoltorio}>
              <table className={styles.tabela} aria-labelledby="t-longos-do-setor">
                <thead>
                  <tr>
                    <th>{t.colunaTitulo}</th>
                    <th>{t.colunaDuracao}</th>
                    <th>{t.colunaVisualizacoes}</th>
                    <th>{t.colunaCapitulos}</th>
                    <th>{t.colunaLeitura}</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((v) => {
                    const endereco = enderecoHttpsSeguro(v.url);
                    const nome = v.titulo?.trim() || v.idExterno;
                    return (
                      <tr key={v.id} data-longo={v.id}>
                        <td>
                          {endereco ? (
                            <Link href={endereco} target="_blank" rel="noopener noreferrer">
                              {nome}
                            </Link>
                          ) : (
                            nome
                          )}
                        </td>
                        <td className={styles.mono}>{t.minutos(emMinutos(v.duracaoS))}</td>
                        <td className={styles.mono}>{v.views.toLocaleString("pt-BR")}</td>
                        <td>{t.capitulos(v.capitulos.length)}</td>
                        <td>{v.temAnaliseLonga ? t.lidoEEstruturado : v.temTranscricao ? t.lido : t.naoLido}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {totalNaLista > lista.length ? <p className={styles.contagem}>{t.mostrando(lista.length, totalNaLista)}</p> : null}
          <p className={styles.contagem}>{t.ajuda}</p>
        </>
      )}
    </section>
  );
}
