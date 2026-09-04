import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { nichoPorSlug, videosPorId } from "@/servicos/admin-coleta";
import { modeloNichoAtual } from "@/servicos/pesquisa";
import { textosAdmin } from "@/textos/admin";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import styles from "./page.module.css";

const t = textosAdmin.nichoModelo;

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

export default async function AdminNichoModelo({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const nicho = await nichoPorSlug(slug);
  if (!nicho) notFound();

  const atual = await modeloNichoAtual(nicho.id);
  const idsExemplo = atual?.audiosDaSemana.map((a) => a.videoExemploId) ?? [];
  const videosExemplo = idsExemplo.length > 0 ? await videosPorId(idsExemplo) : [];
  const videoPorId = new Map(videosExemplo.map((v) => [v.id, v]));

  return (
    <div className={styles.pagina}>
      <div>
        <Link href={`/admin/nichos/${slug}`} className={styles.voltar}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> {t.voltar}
        </Link>
        <h1>{nicho.nome}</h1>
        <p className={styles.subtitulo}>{t.titulo}</p>
      </div>

      {!atual ? (
        <EstadoVazio icone={<Sparkles size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : (
        <>
          <div className={styles.metaLinha}>
            <span className={styles.mono}>{t.semana(formatarData(atual.semana))}</span>
            <span className={styles.mono}>
              {t.baseadoEm(atual.modelo.baseadoEm, atual.modelo.acimaDoLimiar ?? atual.modelo.baseadoEm)}
            </span>
          </div>

          <section className={styles.secao}>
            <h2>{t.resumoTitulo}</h2>
            <p>{atual.modelo.resumo}</p>
          </section>

          <section className={styles.secao}>
            <h2>{t.ganchosTitulo}</h2>
            <ul className={styles.lista}>
              {atual.modelo.ganchos.map((gancho, i) => (
                <li key={i}>
                  <span className={styles.rotulo}>{gancho.tipo}</span>
                  <p className={styles.exemplo}>&ldquo;{gancho.exemplo}&rdquo;</p>
                  <span className={styles.legenda}>{t.ganchoFrequencia(gancho.frequencia)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.secao}>
            <h2>{t.duracaoTitulo}</h2>
            <p className={styles.mono}>
              {t.duracaoValor(atual.modelo.duracaoTipicaS.min, atual.modelo.duracaoTipicaS.max)}
            </p>
          </section>

          <section className={styles.secao}>
            <h2>{t.estruturasTitulo}</h2>
            <ul className={styles.listaSimples}>
              {atual.modelo.estruturas.map((estrutura, i) => (
                <li key={i}>{estrutura}</li>
              ))}
            </ul>
          </section>

          <section className={styles.secao}>
            <h2>{t.fechamentosTitulo}</h2>
            <ul className={styles.listaSimples}>
              {atual.modelo.fechamentos.map((fechamento, i) => (
                <li key={i}>{fechamento}</li>
              ))}
            </ul>
          </section>

          <section className={styles.secao}>
            <h2>{t.chamadasFinaisTitulo}</h2>
            <ul className={styles.listaSimples}>
              {atual.modelo.chamadasFinais.map((chamada, i) => (
                <li key={i}>{chamada}</li>
              ))}
            </ul>
          </section>

          <section className={styles.secao}>
            <h2>{t.formatosTitulo}</h2>
            <ul className={styles.listaSimples}>
              {atual.modelo.formatos.map((formato, i) => (
                <li key={i}>
                  {formato.formato} <span className={styles.legenda}>({formato.participacao})</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.secao}>
            <h2>{t.edicaoTitulo}</h2>
            <dl className={styles.definicoes}>
              <dt>{t.edicaoTextoNaTela}</dt>
              <dd>{atual.modelo.edicao.textoNaTela}</dd>
              <dt>{t.edicaoRitmoDeCorte}</dt>
              <dd>{atual.modelo.edicao.ritmoDeCorte}</dd>
              <dt>{t.edicaoRecursos}</dt>
              <dd>
                {atual.modelo.edicao.recursos.length > 0 ? atual.modelo.edicao.recursos.join(", ") : t.semPadrao}
              </dd>
              <dt>{t.edicaoAudio}</dt>
              <dd>{atual.modelo.edicao.audio ?? t.semPadrao}</dd>
            </dl>
          </section>

          <section className={styles.secao}>
            <h2>{t.assuntosQuentesTitulo}</h2>
            <ul className={styles.listaSimples}>
              {atual.modelo.assuntosQuentes.map((assunto, i) => (
                <li key={i}>{assunto}</li>
              ))}
            </ul>
          </section>

          <section className={styles.secao}>
            <h2>{t.audiosDaSemanaTitulo}</h2>
            {atual.audiosDaSemana.length === 0 ? (
              <p className={styles.legenda}>{t.vazioAudiosDaSemana}</p>
            ) : (
              <ul className={styles.lista}>
                {atual.audiosDaSemana.map((audio, i) => {
                  const video = videoPorId.get(audio.videoExemploId);
                  return (
                    <li key={i}>
                      <span className={styles.rotulo}>{audio.nome ?? t.audioSemNome}</span>
                      <span className={styles.legenda}>
                        {audio.autor ?? t.audioSemAutor}, {t.audioContagem(audio.contagem)}
                      </span>
                      {video ? (
                        <Link href={video.url} target="_blank" rel="noopener noreferrer">
                          {t.verVideoDeExemplo}
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
