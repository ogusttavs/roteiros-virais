"use client";

import { Check, CircleAlert, Newspaper, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { textosNoticias } from "@/textos/noticias";
import { Botao } from "@/ui/componentes/Botao";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { abrirNoticiaDoAssuntoAction } from "./acoes";
import { CartaoDeNoticia, type NoticiaNaTela } from "./CartaoDeNoticia";
import { FolhaDosAssuntos, type AssuntoNaFolha } from "./FolhaDosAssuntos";
import styles from "./NoticiasTela.module.css";

type Props = {
  /** "terça-feira, 6 de outubro", pronta do servidor. */
  dataPorExtenso: string;
  nomeDoSetor: string;
  deHoje: NoticiaNaTela[];
  deOntem: NoticiaNaTela[];
  assuntos: AssuntoNaFolha[];
  novasDesdeOntem: number;
  /** A coleta ou a leitura falhou; o que já estava guardado continua (se houver). */
  falha: boolean;
  /** O "ver como" só olha. */
  somenteLeitura: boolean;
};

type Filtro = "tudo" | "setor" | `a-${number}`;

/** Quando chega a próxima coleta (06:00 e 14:00, no fuso de São Paulo), em texto. */
function quandoChega(agora: Date): string {
  const hora = Number(new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).format(agora)) % 24;
  if (hora < 6) return textosNoticias.quandoHoje06;
  if (hora < 14) return textosNoticias.quandoHoje14;
  return textosNoticias.quandoAmanha06;
}

function passa(n: NoticiaNaTela, filtro: Filtro): boolean {
  if (filtro === "tudo") return true;
  if (filtro === "setor") return n.tipo === "setor";
  return n.assuntoId === Number(filtro.slice(2));
}

/**
 * `/noticias` (E53, passo 20): a capa do dia. A data, a linha dos assuntos que a pessoa acompanha (com "Editar", que abre a folha), as pílulas de origem, o destaque com a foto grande e os
 * cartões. Sem notícia nova hoje, o aviso e as de ontem embaixo. Abrir o original ou pedir o roteiro de uma notícia de assunto mantém o assunto vivo (a recusa do "ver como" é ignorada).
 */
export function NoticiasTela({ dataPorExtenso, nomeDoSetor, deHoje, deOntem, assuntos, novasDesdeOntem, falha, somenteLeitura }: Props) {
  const router = useRouter();
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const [chegando, setChegando] = useState<{ assunto: string; quando: string } | null>(null);
  const { fechar: fecharFolha } = useFolhaNoHistorico(folhaAberta, () => setFolhaAberta(false));

  // Um filtro que apontava para um assunto que saiu volta para "Tudo".
  const filtroValido: Filtro = filtro.startsWith("a-") && !assuntos.some((a) => `a-${a.id}` === filtro) ? "tudo" : filtro;
  const hoje = deHoje.filter((n) => passa(n, filtroValido));
  const ontem = deOntem.filter((n) => passa(n, filtroValido));
  // O destaque é a mais nova com foto; sem nenhuma com foto, a mais nova.
  const destaque = hoje.find((n) => n.imagemUrl) ?? hoje[0] ?? null;
  const restoDeHoje = hoje.filter((n) => n !== destaque);

  function abrir(noticia: NoticiaNaTela) {
    if (noticia.tipo === "assunto") void abrirNoticiaDoAssuntoAction(noticia.noticiaId).catch(() => undefined);
  }

  function criarRoteiro(noticia: NoticiaNaTela) {
    abrir(noticia);
    // A do setor vai presa pelo id (`comNoticia`); a de assunto vai pelo título, e o roteiro já usa as notícias do assunto quando o texto o toca.
    router.push(noticia.tipo === "setor" ? `/criar/tema-livre?noticiaId=${noticia.noticiaId}` : `/criar/tema-livre?tema=${encodeURIComponent(noticia.titulo)}`);
  }

  const pilulas: { chave: Filtro; rotulo: string }[] = [
    { chave: "tudo", rotulo: textosNoticias.tudo },
    ...(nomeDoSetor ? [{ chave: "setor" as const, rotulo: nomeDoSetor }] : []),
    ...assuntos.map((a) => ({ chave: `a-${a.id}` as const, rotulo: a.texto })),
  ];

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoTela}>
        <span className={styles.data}>{dataPorExtenso}</span>
        <h1>{textosNoticias.titulo}</h1>
        <p>{novasDesdeOntem > 0 ? textosNoticias.novasDesdeOntem(novasDesdeOntem, assuntos.length > 0) : textosNoticias.nenhumaNova}</p>
      </div>

      {assuntos.length > 0 ? (
        <div>
          <div className={styles.acompanha}>
            <Newspaper aria-hidden="true" strokeWidth={1.5} />
            <p>
              {textosNoticias.voceAcompanha}{" "}
              {assuntos.map((a, i) => (
                <span key={a.id}>
                  <b>{a.texto}</b>
                  {i < assuntos.length - 1 ? ", " : ""}
                </span>
              ))}
              <span className={styles.quantos}>{textosNoticias.ateCinco(assuntos.length)}</span>
            </p>
            <Botao variante="ghost" tamanho="md" onClick={() => setFolhaAberta(true)} aria-haspopup="dialog">
              {textosNoticias.editar}
            </Botao>
          </div>
          {chegando ? (
            <p className={styles.chegando} role="status">
              <RefreshCw aria-hidden="true" strokeWidth={1.75} />
              <span>{textosNoticias.assuntoChegando(chegando.assunto, chegando.quando)}</span>
            </p>
          ) : null}
        </div>
      ) : (
        <section className={[styles.cartao, styles.convite].join(" ")} aria-labelledby="convite-assunto">
          <h2 id="convite-assunto">{textosNoticias.semAssuntoLinha}</h2>
          <p>{textosNoticias.semAssuntoFrase}</p>
          <Botao variante="secundario" tamanho="md" onClick={() => setFolhaAberta(true)} aria-haspopup="dialog">
            {textosNoticias.acompanhar}
          </Botao>
        </section>
      )}

      {pilulas.length > 1 ? (
        <div className={styles.pilulas} role="group" aria-label={textosNoticias.filtroAria}>
          {pilulas.map((p) => (
            <button
              key={p.chave}
              type="button"
              aria-pressed={filtroValido === p.chave}
              className={[styles.pilula, filtroValido === p.chave ? styles.pilulaAtiva : ""].filter(Boolean).join(" ")}
              onClick={() => setFiltro(p.chave)}
            >
              {filtroValido === p.chave ? <Check aria-hidden="true" strokeWidth={2} /> : null}
              {p.rotulo}
            </button>
          ))}
        </div>
      ) : null}

      {falha ? (
        <div className={[styles.cartao, styles.erro].join(" ")}>
          <span className={styles.erroTitulo}>
            <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
            {textosNoticias.erroTitulo}
          </span>
          <p>{textosNoticias.erroFrase}</p>
          <p>{textosNoticias.erroDescricao}</p>
          <Botao variante="secundario" tamanho="md" onClick={() => router.refresh()}>
            {textosNoticias.tentarDeNovo}
          </Botao>
        </div>
      ) : null}

      {hoje.length === 0 ? (
        <div className={[styles.cartao, styles.semNovidade].join(" ")} data-sem-novidade>
          <Newspaper aria-hidden="true" strokeWidth={1.5} />
          <div>
            <h2>{textosNoticias.nadaNovoTitulo}</h2>
            <p>{ontem.length > 0 ? textosNoticias.nadaNovoFrase : textosNoticias.nadaNovoSemOntem}</p>
          </div>
        </div>
      ) : (
        <div className={styles.capa}>
          {destaque ? <CartaoDeNoticia noticia={destaque} destaque aoAbrir={abrir} aoCriarRoteiro={criarRoteiro} /> : null}
          {restoDeHoje.length > 0 ? (
            <div className={styles.grade}>
              {restoDeHoje.map((n) => (
                <CartaoDeNoticia key={n.chave} noticia={n} aoAbrir={abrir} aoCriarRoteiro={criarRoteiro} />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {ontem.length > 0 ? (
        <section className={styles.secao} aria-labelledby="titulo-de-ontem">
          <h2 id="titulo-de-ontem">{textosNoticias.deOntem}</h2>
          <div className={styles.grade}>
            {ontem.map((n) => (
              <CartaoDeNoticia key={n.chave} noticia={n} aoAbrir={abrir} aoCriarRoteiro={criarRoteiro} />
            ))}
          </div>
        </section>
      ) : null}

      <FolhaDosAssuntos
        aberto={folhaAberta}
        aoFechar={fecharFolha}
        assuntos={assuntos}
        somenteLeitura={somenteLeitura}
        aoAcrescentar={(assunto) => setChegando({ assunto, quando: quandoChega(new Date()) })}
      />
    </div>
  );
}
