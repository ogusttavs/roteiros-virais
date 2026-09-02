import { FILAS } from "@/jobs/fila";
import { listarNichosComContagem, ultimaExecucaoPorJob } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";

import { BotaoRodarJob } from "../_jobs/BotaoRodarJob";

import styles from "./page.module.css";

const t = textosAdmin.nichos;

function formatarData(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}

export default async function AdminNichos() {
  const nomesDeJob = Object.values(FILAS);
  const [nichosListados, execucoes] = await Promise.all([
    listarNichosComContagem(),
    ultimaExecucaoPorJob(nomesDeJob),
  ]);

  return (
    <div className={styles.pagina}>
      <h1>{t.titulo}</h1>

      <section>
        <h2>{t.secaoJobs}</h2>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>{t.colunaJob}</th>
              <th>{t.colunaUltimaExecucao}</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {nomesDeJob.map((nome) => {
              const execucao = execucoes[nome];
              return (
                <tr key={nome}>
                  <td>{nome}</td>
                  <td>
                    {execucao
                      ? `${execucao.status} · ${formatarData(execucao.iniciadoEm)}`
                      : t.nuncaRodou}
                  </td>
                  <td>
                    <BotaoRodarJob nome={nome} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>{t.secaoNichos}</h2>
        {nichosListados.length === 0 ? (
          <p>{t.vazio}</p>
        ) : (
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{t.colunaNicho}</th>
                <th>{t.colunaYoutube}</th>
                <th>{t.colunaTiktok}</th>
                <th>{t.colunaInstagram}</th>
                <th>{t.colunaVigiadas}</th>
                <th>{t.colunaStatus}</th>
              </tr>
            </thead>
            <tbody>
              {nichosListados.map((nicho) => (
                <tr key={nicho.id}>
                  <td>{nicho.nome}</td>
                  <td>{nicho.videosPorPlataforma.youtube}</td>
                  <td>{nicho.videosPorPlataforma.tiktok}</td>
                  <td>{nicho.videosPorPlataforma.instagram}</td>
                  <td>{nicho.contasVigiadas}</td>
                  <td>{nicho.ativo ? t.ativo : t.inativo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
