import Link from "next/link";
import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { textosInteressados as t } from "@/textos/interessados";
import { Logo } from "@/ui/Logo";

import styles from "./page.module.css";
import { QueroTestar } from "./QueroTestar";

/**
 * A página de entrada (E57a): o que o produto faz, o preço do plano trimestral e o "Quero testar". Pública (`middleware.ts` deixa só a raiz exata passar). Quem já está com sessão
 * vai direto para o painel, o mesmo destino que `/entrar` dá a quem já entrou. É a versão básica; a caprichada (E57b) vem depois, com o desenho do Opus e o nome definitivo.
 */
export default async function Inicio() {
  const sessao = await sessaoAtual();
  if (sessao) {
    redirect(sessao.user.role === "admin" ? "/admin" : "/hoje");
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.halo} aria-hidden="true" />
      <div className={styles.miolo}>
        <header className={styles.topo}>
          <span data-app-name="">
            <Logo altura={28} />
          </span>
          <Link href="/entrar" className={styles.linkTopo}>
            {t.topo.entrar}
          </Link>
        </header>

        <main>
          <section className={styles.heroi} aria-labelledby="titulo-heroi">
            <h1 id="titulo-heroi" className={styles.tituloHeroi}>
              {t.heroi.titulo}
            </h1>
            <p className={styles.subtituloHeroi}>{t.heroi.subtitulo}</p>
            <a href={`#${t.formulario.ancora}`} className={styles.botaoHeroi}>
              {t.heroi.botao}
            </a>
          </section>

          <section className={styles.secao} aria-labelledby="titulo-passos">
            <h2 id="titulo-passos" className={styles.tituloSecao}>
              {t.passos.titulo}
            </h2>
            <ol className={styles.passos}>
              {t.passos.itens.map((passo) => (
                <li key={passo.numero} className={styles.passo}>
                  <span className={styles.numeroDoPasso} aria-hidden="true">
                    {passo.numero}
                  </span>
                  <h3 className={styles.tituloDoPasso}>{passo.titulo}</h3>
                  <p className={styles.textoDoPasso}>{passo.texto}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.secao} aria-labelledby="titulo-porque">
            <h2 id="titulo-porque" className={styles.tituloSecao}>
              {t.porque.titulo}
            </h2>
            <p className={styles.porque}>{t.porque.frase}</p>
          </section>

          <section className={styles.secao} aria-labelledby="titulo-preco">
            <h2 id="titulo-preco" className={styles.tituloSecao}>
              {t.preco.titulo}
            </h2>
            <div className={styles.preco}>
              <p className={styles.nomeDoPlano}>{t.preco.nomeDoPlano}</p>
              <p className={styles.valor} data-preco="">
                {t.preco.porMes}
              </p>
              <p className={styles.valorTotal}>{t.preco.total}</p>
              <ul className={styles.detalhes}>
                {t.preco.detalhes.map((detalhe) => (
                  <li key={detalhe}>{detalhe}</li>
                ))}
              </ul>
            </div>
          </section>

          <section id={t.formulario.ancora} className={styles.secao} aria-labelledby="titulo-formulario">
            <div className={styles.cartaoFormulario}>
              <h2 id="titulo-formulario" className={styles.tituloSecao}>
                {t.formulario.titulo}
              </h2>
              <p className={styles.subtituloFormulario}>{t.formulario.subtitulo}</p>
              <QueroTestar
                textos={{
                  ...t.formulario,
                  erroGenerico: t.erros.generico,
                  semConexao: t.erros.semConexao,
                }}
              />
            </div>
          </section>
        </main>

        <footer className={styles.rodape}>
          <span data-app-name="">{config.appName}</span>
          <nav aria-label="Informações" className={styles.linksDoRodape}>
            <Link href="/termos">{t.rodape.termos}</Link>
            <Link href="/privacidade">{t.rodape.privacidade}</Link>
            <Link href="/entrar">{t.rodape.entrar}</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
