import { List } from "lucide-react";
import Link from "next/link";

import {
  custoPorClientePorMes,
  listarClientesComGeracao,
  listarGeracoesRecentes,
  listarTarefasComGeracao,
  resumoGeracoes,
  META_CUSTO_CLIENTE_USD,
} from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";
import chipStyles from "@/ui/componentes/Chips.module.css";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { FiltroGeracoes } from "./FiltroGeracoes";
import styles from "./page.module.css";

const t = textosAdmin.geracoes;
const CAMBIO_USD_BRL = 5.5;

function formatarData(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}

function formatarCusto(valor: number): string {
  return `US$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

function formatarCustoDuasCasas(valor: number): string {
  return `US$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatarReais(valor: number): string {
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatarPercentual(valor: number | null): string {
  if (valor === null) return t.semAvaliacao;
  return `${(valor * 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}%`;
}

function formatarAvaliacao(
  avaliacao: "gostei" | "nao_gostei" | "outro_angulo" | null,
  motivo: string | null,
): string {
  if (!avaliacao) return t.semAvaliacao;
  const rotulo = avaliacao === "gostei" ? "gostei" : avaliacao === "nao_gostei" ? "não gostei" : "pediu outro ângulo";
  return motivo ? `${rotulo}: ${motivo}` : rotulo;
}

type SearchParams = { periodo?: string; tarefa?: string; clienteId?: string };

/**
 * /admin/geracoes (etapa 12, decisão 8; resumo, filtro e custo por cliente
 * na etapa 18, decisões 1 a 3 do `PROXIMO.md`). So leitura, nenhum texto de
 * roteiro de cliente aparece aqui, so contagem e motivo.
 */
export default async function AdminGeracoes({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const dias = params.periodo === "30" ? 30 : 7;
  const tarefa = params.tarefa || undefined;
  const clienteId = params.clienteId ? Number(params.clienteId) : undefined;

  const [resumo, custoPorCliente, tarefas, clientesComGeracao, geracoes] = await Promise.all([
    resumoGeracoes({ dias, tarefa, clienteId }),
    custoPorClientePorMes(),
    listarTarefasComGeracao(),
    listarClientesComGeracao(),
    listarGeracoesRecentes(50, { tarefa, clienteId }),
  ]);

  const metaBrl = META_CUSTO_CLIENTE_USD * CAMBIO_USD_BRL;

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoLista}>
        <div>
          <h1>{t.titulo}</h1>
          <p className={styles.subtitulo}>{t.subtitulo(resumo.totalGeracoes, dias)}</p>
        </div>
      </div>

      <div className={styles.linhaFiltros}>
        <nav aria-label="período" className={chipStyles.grupo}>
          {([7, 30] as const).map((periodo) => {
            const proximosParams = new URLSearchParams();
            if (tarefa) proximosParams.set("tarefa", tarefa);
            if (clienteId) proximosParams.set("clienteId", String(clienteId));
            proximosParams.set("periodo", String(periodo));
            const ativo = dias === periodo;
            return (
              <Link
                key={periodo}
                href={`/admin/geracoes?${proximosParams.toString()}`}
                aria-current={ativo ? "true" : undefined}
                className={[chipStyles.chip, ativo ? chipStyles.ativo : ""].filter(Boolean).join(" ")}
              >
                {periodo === 7 ? t.periodo7 : t.periodo30}
              </Link>
            );
          })}
        </nav>
        <FiltroGeracoes tarefas={tarefas} clientes={clientesComGeracao} />
      </div>

      <section className={styles.resumo}>
        <h2>{t.resumoTitulo(resumo.totalGeracoes)}</h2>
        {resumo.totalGeracoes === 0 ? (
          <p>{t.resumoVazio}</p>
        ) : (
          <>
            <div className={styles.cartoes}>
              <div className={styles.cartao}>
                <span className={styles.cartaoRotulo}>{t.custoTotal}</span>
                <span className={styles.cartaoValor}>{formatarCusto(resumo.custoTotalUsd)}</span>
              </div>
              <div className={styles.cartao}>
                <span className={styles.cartaoRotulo}>{t.custoMedio}</span>
                <span className={styles.cartaoValor}>{formatarCusto(resumo.custoMedioUsd)}</span>
              </div>
              <div className={styles.cartao}>
                <span className={styles.cartaoRotulo}>
                  {t.tokensTitulo} ({t.tokensEntrada})
                </span>
                <span className={styles.cartaoValor}>{resumo.tokensEntrada.toLocaleString("pt-BR")}</span>
              </div>
              <div className={styles.cartao}>
                <span className={styles.cartaoRotulo}>
                  {t.tokensTitulo} ({t.tokensSaida})
                </span>
                <span className={styles.cartaoValor}>{resumo.tokensSaida.toLocaleString("pt-BR")}</span>
              </div>
              <div className={styles.cartao}>
                <span className={styles.cartaoRotulo}>
                  {t.tokensTitulo} ({t.tokensCache})
                </span>
                <span className={styles.cartaoValor}>
                  {resumo.tokensCache.toLocaleString("pt-BR")}
                  {resumo.proporcaoCache !== null ? ` (${t.proporcaoCache(formatarPercentual(resumo.proporcaoCache))})` : ""}
                </span>
              </div>
            </div>

            <div className={styles.secaoResumo}>
              <h3>{t.taxasTitulo}</h3>
              {resumo.avaliadas === 0 ? (
                <p>{t.semAvaliacaoAinda}</p>
              ) : (
                <div className={styles.cartoes}>
                  <div className={styles.cartao}>
                    <span className={styles.cartaoRotulo}>{t.taxaGostaram}</span>
                    <span className={styles.cartaoValor}>{formatarPercentual(resumo.taxaGostei)}</span>
                  </div>
                  <div className={styles.cartao}>
                    <span className={styles.cartaoRotulo}>{t.taxaNaoGostaram}</span>
                    <span className={styles.cartaoValor}>{formatarPercentual(resumo.taxaNaoGostei)}</span>
                  </div>
                  <div className={styles.cartao}>
                    <span className={styles.cartaoRotulo}>{t.taxaOutroAngulo}</span>
                    <span className={styles.cartaoValor}>{formatarPercentual(resumo.taxaOutroAngulo)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.secaoResumo}>
              <h3>{t.motivosTitulo}</h3>
              {resumo.motivosOutroAnguloPorTarefa.length === 0 ? (
                <p>{t.semMotivos}</p>
              ) : (
                <ul className={styles.motivosLista}>
                  {resumo.motivosOutroAnguloPorTarefa.map((grupo) => (
                    <li key={grupo.tarefa}>
                      <span className={styles.motivoTarefa}>{grupo.tarefa}</span>
                      {grupo.motivos.map((m) => (
                        <div key={m.motivo} className={styles.motivoItem}>
                          <span>{m.motivo}</span>
                          <span className={styles.mono}>{m.contagem}</span>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      <section className={styles.resumo}>
        <h2>{t.custoPorClienteTitulo}</h2>
        <p className={styles.metaTexto}>
          {t.meta(formatarCustoDuasCasas(META_CUSTO_CLIENTE_USD), formatarReais(metaBrl))}
        </p>
        {custoPorCliente.length === 0 ? (
          <p>{t.custoPorClienteVazio}</p>
        ) : (
          <div className={styles.tabelaEnvoltorio}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>{t.colunaCliente}</th>
                  <th>{t.colunaCustoMes}</th>
                </tr>
              </thead>
              <tbody>
                {custoPorCliente.map((c) => (
                  <tr key={c.clienteId}>
                    <td>{c.nomeCliente}</td>
                    <td className={[styles.mono, c.acimaDaMeta ? styles.acimaDaMeta : ""].filter(Boolean).join(" ")}>
                      {formatarCusto(c.custoUsd)}
                      {c.acimaDaMeta ? ` (${t.acimaDaMeta})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {geracoes.length === 0 ? (
        <EstadoVazio icone={<List size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{t.colunaData}</th>
                <th>{t.colunaTarefa}</th>
                <th>{t.colunaModelo}</th>
                <th>{t.colunaCusto}</th>
                <th>{t.colunaPrompt}</th>
                <th>{t.colunaAvaliacao}</th>
              </tr>
            </thead>
            <tbody>
              {geracoes.map((geracao) => (
                <tr key={geracao.id}>
                  <td className={styles.mono}>
                    <Link href={`/admin/geracoes/${geracao.id}`}>{formatarData(geracao.criadoEm)}</Link>
                  </td>
                  <td>{geracao.tarefa}</td>
                  <td className={styles.mono}>{geracao.modelo}</td>
                  <td className={styles.mono}>{formatarCusto(geracao.custoUsd)}</td>
                  <td className={styles.mono}>{geracao.versaoPrompt}</td>
                  <td className={geracao.avaliacao ? undefined : styles.semAvaliacao}>
                    {formatarAvaliacao(geracao.avaliacao, geracao.motivoAvaliacao)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
