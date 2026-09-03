import { List } from "lucide-react";
import Link from "next/link";

import { listarNichosComContagem } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import styles from "./page.module.css";

const t = textosAdmin.nichos;

function formatarData(data: Date | null): string {
  if (!data) return t.nuncaLeu;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}

export default async function AdminNichos() {
  const nichosListados = await listarNichosComContagem();

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoLista}>
        <div>
          <h1>{t.titulo}</h1>
          <p className={styles.subtitulo}>{t.subtitulo(nichosListados.length)}</p>
        </div>
      </div>

      {nichosListados.length === 0 ? (
        <EstadoVazio icone={<List size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{t.colunaNome}</th>
                <th>{t.colunaVideos}</th>
                <th>{t.colunaContas}</th>
                <th>{t.colunaUltimaLeitura}</th>
                <th>{t.colunaEstado}</th>
              </tr>
            </thead>
            <tbody>
              {nichosListados.map((nicho) => {
                const totalVideos =
                  nicho.videosPorPlataforma.youtube +
                  nicho.videosPorPlataforma.tiktok +
                  nicho.videosPorPlataforma.instagram;
                return (
                  <tr key={nicho.id}>
                    <td>
                      <Link href={`/admin/nichos/${nicho.slug}`}>{nicho.nome}</Link>
                    </td>
                    <td className={styles.mono}>{totalVideos.toLocaleString("pt-BR")}</td>
                    <td className={styles.mono}>{nicho.contasVigiadas}</td>
                    <td className={styles.mono}>{formatarData(nicho.ultimaLeitura)}</td>
                    <td>
                      <span
                        className={[styles.ponto, nicho.ativo ? styles.pontoPositivo : styles.pontoErro].join(" ")}
                        aria-hidden="true"
                      />
                      {nicho.ativo ? t.ativo : t.inativo}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
