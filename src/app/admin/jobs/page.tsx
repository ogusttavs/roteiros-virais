import { FILAS, type NomeFila } from "@/jobs/fila";
import { listarExecucoesRecentes } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";

import { BotaoRodarJob } from "../_jobs/BotaoRodarJob";

import styles from "./page.module.css";

const t = textosAdmin.jobs;
const NOMES_DE_JOB = Object.values(FILAS);

function formatarData(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(data);
}

function formatarDuracao(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ehNomeDeJob(valor: string | undefined): valor is NomeFila {
  return valor !== undefined && (NOMES_DE_JOB as string[]).includes(valor);
}

export default async function AdminJobs({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const filtro = ehNomeDeJob(job) ? job : undefined;
  const execucoes = await listarExecucoesRecentes(filtro, 50);

  return (
    <div className={styles.pagina}>
      <h1>{t.titulo}</h1>

      <div className={styles.acoes}>
        {NOMES_DE_JOB.map((nome) => (
          <BotaoRodarJob key={nome} nome={nome} />
        ))}
      </div>

      <form method="GET" className={styles.filtro}>
        <select name="job" defaultValue={filtro ?? ""}>
          <option value="">{t.filtroTodos}</option>
          {NOMES_DE_JOB.map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
        </select>
        <button type="submit">{t.botaoFiltrar}</button>
      </form>

      {execucoes.length === 0 ? (
        <p>{t.vazio}</p>
      ) : (
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>{t.colunaJob}</th>
              <th>{t.colunaInicio}</th>
              <th>{t.colunaDuracao}</th>
              <th>{t.colunaStatus}</th>
              <th>{t.colunaResultado}</th>
            </tr>
          </thead>
          <tbody>
            {execucoes.map((execucao) => (
              <tr key={execucao.id}>
                <td>{execucao.nome}</td>
                <td>{formatarData(execucao.iniciadoEm)}</td>
                <td>{formatarDuracao(execucao.duracaoMs)}</td>
                <td className={styles[execucao.status]}>
                  {execucao.status === "ok" ? t.statusOk : execucao.status === "erro" ? t.statusErro : t.statusRodando}
                </td>
                <td className={styles.resultado}>
                  {execucao.erro ?? (execucao.resumo ? JSON.stringify(execucao.resumo) : "-")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
