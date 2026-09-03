import { ArrowLeft, Eye, TrendingUp, Video } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { listarContasVigiadas, nichoPorSlug } from "@/servicos/admin-coleta";
import { foraDaCurvaDoNicho, subindoHoje, type VideoRankeado } from "@/servicos/pesquisa";
import { textosAdmin } from "@/textos/admin";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import styles from "./page.module.css";

const t = textosAdmin.nichoDetalhe;

function formatarNumero(valor: number | null, casas = 1): string {
  if (valor === null) return t.semDado;
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function TabelaVideos({ videos, colunaNumero }: { videos: VideoRankeado[]; colunaNumero: "foraDaCurva" | "velocidadeRelativa" }) {
  return (
    <div className={styles.tabelaEnvoltorio}>
      <table className={styles.tabela}>
        <thead>
          <tr>
            <th>{t.colunaPlataforma}</th>
            <th>{t.colunaConta}</th>
            <th>{t.colunaViews}</th>
            <th>{colunaNumero === "foraDaCurva" ? t.colunaForaDaCurva : t.colunaVelocidadeRelativa}</th>
            <th>{t.verVideo}</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((video) => (
            <tr key={video.id}>
              <td>{video.plataforma}</td>
              <td>{video.contaHandle ?? t.semDado}</td>
              <td className={styles.mono}>{video.views.toLocaleString("pt-BR")}</td>
              <td className={styles.mono}>{formatarNumero(video[colunaNumero])}</td>
              <td>
                <Link href={video.url} target="_blank" rel="noopener noreferrer">
                  {t.verVideo}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminNichoDetalhe({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const nicho = await nichoPorSlug(slug);
  if (!nicho) notFound();

  const [foraDaCurva, subindo, vigiadas] = await Promise.all([
    foraDaCurvaDoNicho(nicho.id, 90, 30),
    subindoHoje(nicho.id, 30),
    listarContasVigiadas(nicho.id),
  ]);

  return (
    <div className={styles.pagina}>
      <div>
        <Link href="/admin/nichos" className={styles.voltar}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> {t.voltar}
        </Link>
        <h1>{nicho.nome}</h1>
      </div>

      <section className={styles.secao}>
        <div className={styles.tituloComContagem}>
          <h2>{t.foraDaCurvaTitulo}</h2>
          <span className={styles.contagem}>{foraDaCurva.length}</span>
        </div>
        {foraDaCurva.length === 0 ? (
          <EstadoVazio icone={<Video size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazioForaDaCurva} />
        ) : (
          <TabelaVideos videos={foraDaCurva} colunaNumero="foraDaCurva" />
        )}
      </section>

      <section className={styles.secao}>
        <div className={styles.tituloComContagem}>
          <h2>{t.subindoHojeTitulo}</h2>
          <span className={styles.contagem}>{subindo.length}</span>
        </div>
        {subindo.length === 0 ? (
          <EstadoVazio icone={<TrendingUp size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazioSubindoHoje} />
        ) : (
          <TabelaVideos videos={subindo} colunaNumero="velocidadeRelativa" />
        )}
      </section>

      <section className={styles.secao}>
        <div className={styles.tituloComContagem}>
          <h2>{t.vigilanciaTitulo}</h2>
          <span className={styles.contagem}>{vigiadas.length}</span>
        </div>
        {vigiadas.length === 0 ? (
          <EstadoVazio icone={<Eye size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazioVigilancia} />
        ) : (
          <div className={styles.tabelaEnvoltorio}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>{t.colunaPlataforma}</th>
                  <th>{t.colunaConta}</th>
                  <th>{t.colunaTaxa}</th>
                  <th>{t.colunaMediana}</th>
                </tr>
              </thead>
              <tbody>
                {vigiadas.map((conta) => (
                  <tr key={conta.id}>
                    <td>{conta.plataforma}</td>
                    <td>{conta.handle}</td>
                    <td className={styles.mono}>{formatarNumero(conta.taxaForaDaCurva, 2)}</td>
                    <td className={styles.mono}>{formatarNumero(conta.medianaViews, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
