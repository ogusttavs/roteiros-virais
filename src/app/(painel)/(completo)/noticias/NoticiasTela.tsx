"use client";

import { CircleAlert, ExternalLink, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { PeriodoNoticias } from "@/servicos/noticias";
import { textosNoticias } from "@/textos/noticias";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import styles from "./NoticiasTela.module.css";

export type NoticiaFormatada = {
  id: number;
  titulo: string;
  /** "Ler no site": nunca a matéria inteira, só o link para o original (cuidado 1 do escopo da E43). */
  url: string;
  resumo: string | null;
  angulo: string | null;
  /** Pronta do servidor: "Portal do Varejo · há 3 horas" (`formatarFonteEData`). */
  fonteEDataRelativa: string;
  /** Pronta do servidor, com a hora exata: só para a folha aberta (dúvida 3 do passo 11). */
  fonteEDataCompleta: string;
  virouRoteiro: boolean;
  roteiroId: number | null;
};

type Props = {
  noticias: NoticiaFormatada[];
  periodo: PeriodoNoticias;
  contagemSemana: number;
  /** A coleta de hoje falhou; a lista mostrada é a de semana mesmo assim (dúvida 12 do passo 11). */
  falhaNaColeta: boolean;
};

const PERIODOS: { valor: PeriodoNoticias; rotulo: string }[] = [
  { valor: "hoje", rotulo: textosNoticias.periodoHoje },
  { valor: "semana", rotulo: textosNoticias.periodoSemana },
  { valor: "mes", rotulo: textosNoticias.periodoMes },
];

/** O bloco "Como isso vira vídeo seu" (dúvida 4 do passo 11: mesmo visual da sugestão do briefing, só leitura aqui). */
function BlocoAngulo({ angulo }: { angulo: string }) {
  return (
    <div className={styles.angulo}>
      <span className={styles.anguloRotulo}>
        <Zap size={14} strokeWidth={1.75} aria-hidden="true" />
        {textosNoticias.comoViraVideo}
      </span>
      <p className={styles.anguloTexto}>{angulo}</p>
    </div>
  );
}

/**
 * `/noticias` (E43): o filtro de período é navegação de servidor comum (sem o otimismo de
 * Referências, a lista é bem mais leve). A notícia aberta é uma folha (dúvida 6 do passo 11), com
 * "Criar vídeo com esta notícia" e "Ler no site"; a primeira leva para `/criar/tema-livre`.
 */
export function NoticiasTela({ noticias, periodo, contagemSemana, falhaNaColeta }: Props) {
  const router = useRouter();
  const [trocandoPeriodo, iniciarTransicao] = useTransition();
  const [noticiaAbertaId, setNoticiaAbertaId] = useState<number | null>(null);
  const { fechar: fecharFolha, fecharENavegar } = useFolhaNoHistorico(noticiaAbertaId !== null, () =>
    setNoticiaAbertaId(null),
  );

  function trocarPeriodo(novo: PeriodoNoticias) {
    iniciarTransicao(() => router.push(`/noticias?periodo=${novo}`));
  }

  const noticiaAberta = noticias.find((n) => n.id === noticiaAbertaId) ?? null;
  const poucaNoticia = periodo === "semana" && noticias.length > 0 && contagemSemana < 3;
  const vazio = noticias.length === 0;

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoTela}>
        <h1>{textosNoticias.titulo}</h1>
        <p>{textosNoticias.subtitulo}</p>
      </div>

      <div className={styles.filtro} role="radiogroup" aria-label={textosNoticias.tituloCompacto}>
        {PERIODOS.map(({ valor, rotulo }) => (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={periodo === valor}
            className={[styles.chip, periodo === valor ? styles.chipAtivo : ""].filter(Boolean).join(" ")}
            disabled={trocandoPeriodo}
            onClick={() => trocarPeriodo(valor)}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {falhaNaColeta ? (
        <div className={[styles.cartao, styles.aviso].join(" ")}>
          <span className={styles.avisoTitulo}>
            <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
            {textosNoticias.erroTitulo}
          </span>
          <p>{textosNoticias.erroFrase}</p>
          <p className={styles.avisoDescricao}>{textosNoticias.erroDescricao}</p>
        </div>
      ) : null}

      {vazio ? (
        periodo === "hoje" ? (
          <div className={[styles.cartao, styles.estado].join(" ")}>
            <h2>{textosNoticias.vazioTitulo}</h2>
            <p>{textosNoticias.vazioFrase(contagemSemana)}</p>
            <Botao variante="secundario" tamanho="md" onClick={() => trocarPeriodo("semana")}>
              {textosNoticias.verASemana}
            </Botao>
          </div>
        ) : (
          <div className={[styles.cartao, styles.estado].join(" ")}>
            <h2>{textosNoticias.vazioTitulo}</h2>
          </div>
        )
      ) : (
        <>
          {poucaNoticia ? (
            <div className={[styles.cartao, styles.avisoSuave].join(" ")}>
              <span className={styles.avisoTitulo}>{textosNoticias.poucaNoticiaTitulo}</span>
              <p>{textosNoticias.poucaNoticiaFrase(contagemSemana)}</p>
            </div>
          ) : null}

          <p className={styles.rotuloQuantidade}>{textosNoticias.quantasNestePeriodo(noticias.length, periodo)}</p>

          <div className={styles.grade}>
            {/*
              Acabamento da E43 (achado de acessibilidade, revisão do Fable em 02/10): um `<button>`
              não pode conter um `<Link>` (vira `<a>` dentro de `<button>`, HTML inválido e ruim para
              leitor de tela). O cartão vira `<article>` com um botão cobrindo tudo (só a abertura da
              folha) e o "Ver o roteiro" como link irmão, por cima, independente, sem mudar a aparência.
            */}
            {noticias.map((noticia) => (
              <article key={noticia.id} className={[styles.cartao, styles.noticia].join(" ")}>
                <button
                  type="button"
                  className={styles.coberturaNoticia}
                  aria-label={noticia.titulo}
                  onClick={() => setNoticiaAbertaId(noticia.id)}
                />
                <div className={styles.fonte}>
                  <span>{noticia.fonteEDataRelativa}</span>
                </div>
                <h3 className={styles.tituloNoticia}>{noticia.titulo}</h3>
                {noticia.resumo ? <p className={styles.resumo}>{noticia.resumo}</p> : null}
                {noticia.angulo ? <BlocoAngulo angulo={noticia.angulo} /> : null}
                <div className={styles.peNoticia}>
                  {noticia.virouRoteiro && noticia.roteiroId ? (
                    <>
                      <span className={styles.virouRoteiro}>{textosNoticias.virouRoteiro}</span>
                      <Link href={`/roteiros/${noticia.roteiroId}`} className={styles.verRoteiro}>
                        {textosNoticias.verORoteiro}
                      </Link>
                    </>
                  ) : (
                    <span className={styles.abrirRotulo}>{textosNoticias.abrir}</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {noticiaAberta ? (
        <Folha
          titulo={noticiaAberta.titulo}
          aberto={noticiaAbertaId !== null}
          aoFechar={fecharFolha}
          rodape={
            <>
              <Botao
                variante="primario"
                tamanho="lg"
                onClick={() => fecharENavegar(() => router.push(`/criar/tema-livre?noticiaId=${noticiaAberta.id}`))}
              >
                {textosNoticias.criarVideoComEstaNoticia}
              </Botao>
              <a href={noticiaAberta.url} target="_blank" rel="noopener noreferrer" className={styles.lerNoSite}>
                <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
                {textosNoticias.lerNoSite}
              </a>
            </>
          }
        >
          <div className={styles.corpoFolha}>
            <span className={styles.fonteCompleta}>{noticiaAberta.fonteEDataCompleta}</span>
            <p className={styles.resumoInteiro}>{noticiaAberta.resumo}</p>
            <p className={styles.deQuem}>{textosNoticias.resumoNosso}</p>
            {noticiaAberta.angulo ? <BlocoAngulo angulo={noticiaAberta.angulo} /> : null}
          </div>
        </Folha>
      ) : null}
    </div>
  );
}
