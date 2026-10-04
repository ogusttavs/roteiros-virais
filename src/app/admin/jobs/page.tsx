import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { ROTINAS, quandoDoCron, type Rotina } from "@/config/rotinas";
import { AGENDAMENTOS } from "@/jobs/agenda";
import { FILAS, FILAS_POR_EVENTO } from "@/jobs/fila";
import { exigirAdmin } from "@/lib/sessao";
import { listarExecucoesRecentes, taxaDeAcertoPorExecucao, type ExecucaoResumo } from "@/servicos/admin-coleta";
import { inicioDoAdmin } from "@/servicos/admin-inicio";
import { ultimosDisparos } from "@/servicos/admin-rotinas";
import { quandoPorExtenso, textosInicioAdmin as tc } from "@/textos/admin-contas";
import { textosRotinasAdmin as t } from "@/textos/admin-custos";
import { fraseDoErro } from "@/textos/rotinas";

import { BotaoRodarJob } from "../_jobs/BotaoRodarJob";
import comum from "../comum.module.css";

import proprio from "./rotinas.module.css";

const styles = { ...comum, ...proprio };

/** So essas filas pagam o Apify por resultado; so nelas a taxa de acerto faz sentido. */
const FILAS_DE_COLETA_PAGA = new Set<string>([FILAS.coletaApify, FILAS.coletaMeioDia]);

type EstadoDaRotina = "ok" | "erro" | "rodando" | "nunca";

function numeroDoResumo(resumo: Record<string, unknown> | null, chave: string): number | null {
  const valor = resumo?.[chave];
  return typeof valor === "number" ? valor : null;
}

function duracao(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function dataHora(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(d) : "-";
}

/** O pior estado entre a última execução de cada fila da rotina: falhou vence rodando, que vence deu certo. Sem nenhuma execução: nunca rodou. */
function estadoDaRotina(ultimas: (ExecucaoResumo | undefined)[], agora: Date): EstadoDaRotina {
  const existentes = ultimas.filter((e): e is ExecucaoResumo => Boolean(e));
  if (existentes.length === 0) return "nunca";
  // Um erro de mais de 3 dias numa fila rara (a mensal, a semanal) não faz a rotina inteira falhar para sempre: ela só aparece com o erro à mostra no detalhe.
  if (existentes.some((e) => e.status === "erro" && agora.getTime() - e.iniciadoEm.getTime() < 3 * 24 * 60 * 60 * 1000)) return "erro";
  if (existentes.some((e) => e.status === "rodando")) return "rodando";
  return "ok";
}

/** O resultado em uma frase: o erro, ou os três primeiros números do resumo da execução. */
function resultadoEmFrase(e: ExecucaoResumo | undefined): string {
  if (!e) return t.rotinas.semExecucao;
  if (e.status === "erro") return fraseDoErro(e.erro);
  // Sem as chaves cruas do resumo (nome técnico): o cartão diz como terminou, e os números ficam no detalhe.
  return e.status === "rodando" ? t.rotinas.estado.rodando : `${t.rotinas.estado.ok}, em ${duracao(e.duracaoMs)}`;
}

function diaPorExtenso(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(d);
}

/** `/admin/jobs`: as Rotinas (E46 PR 3, `AdminJobs.dc.html`): a madrugada de hoje por ramo e o que cada rotina fez da última vez, com o detalhe técnico dentro. */
export default async function Rotinas() {
  await exigirAdmin();
  const inicio = await inicioDoAdmin();
  const { madrugada } = inicio;
  const todasAsFilas = ROTINAS.flatMap((r) => r.filas);
  const recentes = new Map(await Promise.all(todasAsFilas.map(async (nome) => [nome, await listarExecucoesRecentes(nome, 3)] as const)));
  const idsPagos = [...recentes.entries()].filter(([nome]) => FILAS_DE_COLETA_PAGA.has(nome)).flatMap(([, lista]) => lista.map((e) => e.id));
  const taxas = new Map((await taxaDeAcertoPorExecucao(idsPagos)).map((x) => [x.execucaoId, x]));
  const disparos = await ultimosDisparos(todasAsFilas);
  const agendas = (filas: string[]) => AGENDAMENTOS.filter((a) => filas.includes(a.fila));

  return (
    <div className={styles.pagina}>
      <div className={styles.topo}>
        <div className={styles.titulos}>
          <h1>{t.titulo}</h1>
          <span className={styles.linhaDoDia}>{t.linha(madrugada.totalDeRamos, ROTINAS.length)}</span>
        </div>
      </div>

      <section className={styles.cartao} aria-labelledby="t-madrugada" data-bloco="madrugada">
        <div className={styles.tabelaTitulo}>
          <h2 id="t-madrugada">{t.madrugada.titulo}</h2>
          <span className={styles.quantos}>{t.madrugada.legenda(madrugada.comProblema.length, madrugada.totalDeRamos, diaPorExtenso(inicio.agora))}</span>
        </div>
        <p className={styles.nota} data-rotinas-globais>
          {t.madrugada.rotinasGlobais}: {t.madrugada.buscaGlobal} {tc.madrugada.estadoRotina[madrugada.rotinas.busca]}, {t.madrugada.transcricaoGlobal} {tc.madrugada.estadoRotina[madrugada.rotinas.transcricao]}.
          {madrugada.rotinas.erroDaBusca ? ` ${fraseDoErro(madrugada.rotinas.erroDaBusca)}` : ""}
        </p>
        {madrugada.linhas.length === 0 ? (
          <p className={styles.semDado}>{t.madrugada.vazio}</p>
        ) : (
          <div className={styles.tabelaArea}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th scope="col">Ramo</th>
                  <th scope="col">{t.madrugada.etapas.busca}</th>
                  <th scope="col">{t.madrugada.etapas.transcricao}</th>
                  <th scope="col">{t.madrugada.etapas.analise}</th>
                  <th scope="col">{t.madrugada.etapas.temas}</th>
                </tr>
              </thead>
              <tbody>
                {madrugada.linhas.map((l) => (
                  <tr key={l.nichoId} data-ramo={l.nichoId} data-problema={l.comProblema ? "sim" : "nao"}>
                    <td className={[styles.forte, styles.corta].join(" ")}>{l.nome}</td>
                    <td>
                      <span className={[styles.etapa, styles.certo].join(" ")}>
                        <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" />
                        {t.madrugada.videos(l.busca.novos)}
                      </span>
                    </td>
                    <td>
                      <span className={[styles.etapa, styles.certo].join(" ")}>
                        <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" />
                        {t.madrugada.transcritos(l.transcricao.transcritos)}
                      </span>
                    </td>
                    <td>
                      <span className={[styles.etapa, styles.certo].join(" ")}>
                        <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" />
                        {t.madrugada.analisados(l.analise.analisados)}
                      </span>
                    </td>
                    <td>
                      {l.temas.quantos > 0 ? (
                        <span className={[styles.etapa, styles.certo].join(" ")}>
                          <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" />
                          {t.madrugada.temas(l.temas.quantos)}
                        </span>
                      ) : l.temas.atrasado ? (
                        <span className={[styles.etapa, styles.falhou].join(" ")}>
                          <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
                          {t.madrugada.naoSaiu}
                        </span>
                      ) : (
                        <span className={styles.etapa}>{t.madrugada.aindaNao}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="t-rotinas" className={styles.blocoRotinas} data-bloco="rotinas">
        <div className={styles.tabelaTitulo}>
          <h2 id="t-rotinas">{t.rotinas.titulo}</h2>
          <span className={styles.quantos}>{t.rotinas.legenda(ROTINAS.length)}</span>
        </div>
        <div className={styles.cartoes}>
          {ROTINAS.map((r: Rotina) => {
            const ultimas = r.filas.map((f) => recentes.get(f)?.[0]);
            const estado = estadoDaRotina(ultimas, inicio.agora);
            const maisRecente = ultimas.filter((e): e is ExecucaoResumo => Boolean(e)).sort((a, b) => b.iniciadoEm.getTime() - a.iniciadoEm.getTime())[0];
            const quando = agendas(r.filas);
            const soPorEvento = r.filas.every((f) => FILAS_POR_EVENTO.has(f));
            return (
              <article key={r.chave} className={styles.cartaoRotina} data-rotina={r.chave} data-estado={estado}>
                <div className={styles.cabecaRotina}>
                  <h3>{r.titulo}</h3>
                  <span className={[styles.etiqueta, estado === "ok" ? styles.etiquetaAtiva : estado === "erro" ? styles.etiquetaAtencao : ""].filter(Boolean).join(" ")}>{t.rotinas.estado[estado]}</span>
                </div>
                <p className={styles.faz}>{r.faz}</p>
                <dl className={styles.dadosRotina}>
                  <div>
                    <dt>{t.rotinas.quando}</dt>
                    <dd>{quando.length > 0 ? [...new Set(quando.map((a) => quandoDoCron(a.cron)))].join("; ") : soPorEvento ? t.rotinas.porEvento : "-"}</dd>
                  </div>
                  <div>
                    <dt>{t.rotinas.ultima}</dt>
                    <dd>{maisRecente ? quandoPorExtenso(maisRecente.iniciadoEm, inicio.agora) : t.rotinas.semExecucao}</dd>
                  </div>
                  <div>
                    <dt>{t.rotinas.resultado}</dt>
                    <dd>{resultadoEmFrase(maisRecente)}</dd>
                  </div>
                </dl>
                <details className={styles.detalhe}>
                  <summary>{t.rotinas.detalhe}</summary>
                  <div className={styles.detalheCorpo}>
                    {r.filas.map((fila) => {
                      const lista = recentes.get(fila) ?? [];
                      const ultima = lista[0];
                      const taxa = ultima && FILAS_DE_COLETA_PAGA.has(fila) ? taxas.get(ultima.id) : undefined;
                      return (
                        <div key={fila} className={styles.filaDetalhe} data-fila={fila}>
                          <div className={styles.cabecaFila}>
                            <span className={styles.nomeTecnico}>
                              {t.rotinas.nomeNoSistema}: {fila}
                            </span>
                            {FILAS_POR_EVENTO.has(fila) ? null : <BotaoRodarJob nome={fila} rotulo={t.rotinas.tentarDeNovo} />}
                          </div>
                          {disparos.get(fila) ? (
                            <p className={styles.nota} data-disparo={fila}>
                              {t.rotinas.rodadaAMao(disparos.get(fila)!.porNome, quandoPorExtenso(disparos.get(fila)!.em, inicio.agora))}
                            </p>
                          ) : null}
                          {ultima ? (
                            <dl className={styles.dadosRotina}>
                              <div>
                                <dt>{t.rotinas.comecou}</dt>
                                <dd>{dataHora(ultima.iniciadoEm)}</dd>
                              </div>
                              <div>
                                <dt>{t.rotinas.terminou}</dt>
                                <dd>{dataHora(ultima.terminadoEm)}</dd>
                              </div>
                              <div>
                                <dt>{t.rotinas.duracao}</dt>
                                <dd>{duracao(ultima.duracaoMs)}</dd>
                              </div>
                            </dl>
                          ) : (
                            <p className={styles.nota}>{t.rotinas.semExecucao}</p>
                          )}
                          {taxa && ultima ? (
                            <p className={styles.nota}>
                              {t.rotinas.taxa(
                                numeroDoResumo(ultima.resumo, "resultadosDevolvidos") ?? 0,
                                numeroDoResumo(ultima.resumo, "resultadosConsumidos") ?? 0,
                                numeroDoResumo(ultima.resumo, "videosNovos") ?? 0,
                                taxa.foraDaCurva,
                                numeroDoResumo(ultima.resumo, "resultadosConsumidos") ? `${((taxa.foraDaCurva / (numeroDoResumo(ultima.resumo, "resultadosConsumidos") as number)) * 100).toFixed(0)}%` : "-",
                              )}
                            </p>
                          ) : null}
                          {ultima?.erro ? (
                            <>
                              <span className={styles.rotulo}>{t.rotinas.oQueFalhou}</span>
                              <pre className={styles.erroCru}>{ultima.erro}</pre>
                            </>
                          ) : null}
                          {lista.length > 1 ? (
                            <>
                              <span className={styles.rotulo}>{t.rotinas.ultimasVezes}</span>
                              <ul className={styles.ultimasVezes}>
                                {lista.map((e) => (
                                  <li key={e.id}>
                                    {dataHora(e.iniciadoEm)}, {t.rotinas.estado[e.status === "ok" ? "ok" : e.status === "erro" ? "erro" : "rodando"]}, {duracao(e.duracaoMs)}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
