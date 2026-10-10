import type { FolhaDoRoteiro, UnidadeDaFolha } from "@/servicos/folha-do-roteiro";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";
import { textosRoteiro } from "@/textos/roteiro";
import { FalaMarcada, MarcaDeDevagar, MarcaDePausa, MarcaDePeso, MarcaDeTom } from "@/ui/componentes/FalaMarcada";

import styles from "./ImpressaoRoteiro.module.css";

/** "Na tela (0 a 2 s): ..." com o começo em negrito, até os dois pontos (só se o começo for curto: uma frase com dois pontos no meio não vira rótulo). */
function LinhaDeMostrar({ linha }: { linha: string }) {
  const corte = linha.indexOf(": ");
  if (corte < 0 || corte > 32) return <p className={styles.naTela}>{linha}</p>;
  return (
    <p className={styles.naTela}>
      <b>{linha.slice(0, corte + 1)}</b> {linha.slice(corte + 2)}
    </p>
  );
}

/** A legenda curta das marcas, no pé da imagem: o papel não abre a folha "Como ler as marcas" (E41 2c; no PDF a mesma legenda vem no pé de cada página, escrita pelo Chromium). */
function LegendaDasMarcas() {
  const l = textosMarcasDeFala.legendaDoPapel;
  return (
    <span className={styles.legendaDasMarcas} data-legenda-das-marcas>
      <MarcaDePeso>{l.peso}</MarcaDePeso>
      <span>
        {l.a}
        <MarcaDePausa duracao="curta" />
        {l.pausa}
      </span>
      <span>
        {l.a}
        <MarcaDePausa duracao="longa" />
        {l.pausaLonga}
      </span>
      <MarcaDeDevagar>{l.devagar}</MarcaDeDevagar>
      <span>
        <MarcaDeTom direcao="desce" />
        {l.tomDesce}
      </span>
      <span>
        <MarcaDeTom direcao="sobe" />
        {l.tomSobe}
      </span>
    </span>
  );
}

/** A fala de uma unidade: com as marcas desenhadas quando a folha as leva (o texto que se lê é o mesmo, letra por letra), senão o texto. */
function FalaDaUnidade({ unidade }: { unidade: UnidadeDaFolha }) {
  return unidade.falaMarcada ? <FalaMarcada marcado={unidade.falaMarcada} /> : <>{unidade.fala}</>;
}

/** As unidades de cada bloco juntas, para a folha A4 (a imagem 9:16 usa as unidades soltas, para poder partir um bloco comprido). */
function agruparEmBlocos(unidades: UnidadeDaFolha[]): UnidadeDaFolha[][] {
  const blocos: UnidadeDaFolha[][] = [];
  let atual: UnidadeDaFolha[] = [];
  for (const unidade of unidades) {
    atual.push(unidade);
    if (unidade.fimDoBloco) {
      blocos.push(atual);
      atual = [];
    }
  }
  if (atual.length > 0) blocos.push(atual);
  return blocos;
}

/** A folha A4: o PDF. O pé com a página é o do Chromium (rota `/api/roteiros/[id]/pdf`). */
export function FolhaA4({ folha }: { folha: FolhaDoRoteiro }) {
  return (
    <main className={styles.pagina} data-folha="a4">
      <header className={styles.cabeca}>
        <span className={styles.marcaDaPessoa}>{folha.marca}</span>
        <span className={styles.dataDoPdf}>{folha.dataLonga}</span>
      </header>

      <div className={styles.titulo}>
        <h1>{folha.titulo}</h1>
        <div className={styles.chips}>
          {folha.chips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
        {folha.recado ? (
          <p className={styles.recado}>
            <b>{textosRoteiro.recadoDoVideo}</b> {folha.recado}
          </p>
        ) : null}
      </div>

      <div className={styles.miolo}>
        <section className={styles.blocos} aria-label={textosRoteiro.folha.oRoteiro}>
          <span className={styles.rotulo}>{textosRoteiro.folha.oRoteiro}</span>
          {agruparEmBlocos(folha.unidades).map((bloco, indice) => (
            <div key={indice} className={styles.bloco} data-bloco-da-folha>
              {bloco[0].tempo || bloco[0].rotulo ? (
                <span className={styles.quando}>
                  {bloco[0].tempo ? <span className={styles.tempo}>{bloco[0].tempo}</span> : null}
                  {bloco[0].rotulo ? <span className={styles.rotulo}>{bloco[0].rotulo}</span> : null}
                  {bloco[0].tom ? <span className={styles.tomDoBloco}>{textosMarcasDeFala.tomNoPapel(bloco[0].tom)}</span> : null}
                </span>
              ) : null}
              {bloco.map((unidade, i) =>
                unidade.fala ? (
                  <p key={i} className={styles.fala}>
                    <FalaDaUnidade unidade={unidade} />
                  </p>
                ) : null,
              )}
              {bloco
                .flatMap((unidade) => unidade.mostrar)
                .map((linha, i) => (
                  <LinhaDeMostrar key={i} linha={linha} />
                ))}
            </div>
          ))}
        </section>

        <aside className={styles.lado}>
          {folha.comoEditar ? (
            <section className={styles.caixa} aria-label={textosRoteiro.comoEditar}>
              <h2>{textosRoteiro.comoEditar}</h2>
              {folha.comoEditar.map((item) => (
                <p key={item.rotulo} className={styles.itemDeEdicao}>
                  <b>{item.rotulo}</b>
                  {item.texto}
                </p>
              ))}
            </section>
          ) : null}
          {folha.legenda ? (
            <section className={styles.caixa} aria-label={textosRoteiro.legenda}>
              <h2>{textosRoteiro.legenda}</h2>
              <p className={styles.legendaDoPost}>{folha.legenda}</p>
            </section>
          ) : null}
          {folha.deOndeVeio ? (
            <section className={styles.caixa} aria-label={textosRoteiro.folha.deOndeVeio}>
              <h2>{textosRoteiro.folha.deOndeVeio}</h2>
              <div className={styles.referencia}>
                {folha.deOndeVeio.conta ? <span className={styles.conta}>{folha.deOndeVeio.conta}</span> : null}
                <span>{folha.deOndeVeio.resumo}</span>
                {folha.deOndeVeio.trecho ? <span>{folha.deOndeVeio.trecho}:</span> : null}
                {folha.deOndeVeio.link ? (
                  <a className={styles.link} href={folha.deOndeVeio.link.href}>
                    {folha.deOndeVeio.link.texto}
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

/**
 * A imagem 9:16: um quadro com todas as unidades; o Playwright parte em quadros novos o que não cabe (`src/lib/paginar-quadros.ts`) e fotografa cada um. Os `data-*` são o contrato com
 * esse código: classes de CSS Module mudam de nome a cada build.
 */
export function QuadroDoCelular({ folha }: { folha: FolhaDoRoteiro }) {
  return (
    <main className={styles.quadros} data-folha="celular">
      <article className={styles.quadro} data-quadro>
        <header className={styles.cabeca} data-cabeca>
          <span className={styles.marcaDaPessoa}>{folha.marca}</span>
          <span className={styles.dataDoPdf}>{folha.dataCurta}</span>
        </header>
        <div className={styles.titulo} data-titulo>
          <h1>{folha.titulo}</h1>
          <div className={styles.chips}>
            {folha.chips.slice(0, 3).map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        </div>
        <section className={styles.blocos} data-blocos>
          {folha.unidades.map((unidade, indice) => (
            <div key={indice} className={styles.bloco} data-unidade {...(unidade.fimDoBloco ? {} : { "data-meio": "" })}>
              {unidade.tempo || unidade.rotulo ? (
                <span className={styles.quando}>
                  <span className={styles.tempo}>{unidade.tempo ?? unidade.rotulo}</span>
                  {unidade.tom ? <span className={styles.tomDoBloco}>{textosMarcasDeFala.tomNoPapel(unidade.tom)}</span> : null}
                </span>
              ) : null}
              {unidade.fala ? (
                <p className={styles.fala}>
                  <FalaDaUnidade unidade={unidade} />
                </p>
              ) : null}
              {unidade.mostrar.map((linha, i) => (
                <LinhaDeMostrar key={i} linha={linha} />
              ))}
            </div>
          ))}
        </section>
        <footer className={[styles.pe, folha.comMarcas ? styles.peComLegenda : ""].filter(Boolean).join(" ")} data-pe>
          {folha.comMarcas ? <LegendaDasMarcas /> : null}
          <span data-pe-texto>{folha.linhaDoPe ?? ""}</span>
          <span data-pe-pagina />
        </footer>
      </article>
    </main>
  );
}
