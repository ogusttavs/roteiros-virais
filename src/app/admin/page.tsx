import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CAMBIO_DATA_TEXTO, CAMBIO_USD_BRL, CUSTO_FIXO_MENSAL_BRL, TETO_DIARIO_BRL, usdParaBrl } from "@/config/dinheiro";
import { exigirAdmin } from "@/lib/sessao";
import { inicioDoAdmin, type InicioAdmin, type LinhaDaMadrugada } from "@/servicos/admin-inicio";
import { dataEHoraPorExtenso, dolares, quandoPorExtenso, reais, textosInicioAdmin as t } from "@/textos/admin-contas";

import comum from "./comum.module.css";
import proprio from "./inicio.module.css";

const styles = { ...comum, ...proprio };

/** Quantos ramos cabem um por linha antes de a tabela mostrar só os que têm algo que não saiu (dúvida do desenho: "a tela nunca vira uma lista sem fim"). */
const RAMOS_POR_LINHA = 8;

type ItemDeAtencao = { chave: string; titulo: string; detalhe: string; href: string; rotulo: string };

function itensDeAtencao(inicio: InicioAdmin): ItemDeAtencao[] {
  const itens: ItemDeAtencao[] = [];
  const comErro = inicio.madrugada.comProblema.filter((l) => l.busca.estado === "erro" || l.transcricao.estado === "erro").map((l) => l.nome);
  const semTemas = inicio.madrugada.comProblema.filter((l) => l.temas.atrasado).map((l) => l.nome);
  if (comErro.length > 0) itens.push({ chave: "erro", ...t.atencao.madrugadaErro(comErro), href: "/admin/jobs", rotulo: t.atencao.verRotinas });
  if (semTemas.length > 0) itens.push({ chave: "temas", ...t.atencao.semTemas(semTemas), href: "/admin/jobs", rotulo: t.atencao.verRotinas });
  const continuam = inicio.erros.recentes.filter((e) => e.continua).length;
  if (continuam > 0) itens.push({ chave: "continuam", ...t.atencao.errosContinuam(continuam), href: "/admin/jobs", rotulo: t.atencao.verRotinas });
  if (inicio.dinheiro.passouDoTeto) {
    itens.push({ chave: "teto", ...t.atencao.teto(reais(usdParaBrl(inicio.dinheiro.saiuHojeUsd)), reais(TETO_DIARIO_BRL)), href: "/admin/geracoes", rotulo: t.atencao.verCustos });
  }
  if (inicio.contas.pararam > 0) itens.push({ chave: "pararam", ...t.atencao.contasPararam(inicio.contas.pararam), href: "/admin/clientes?filtro=parou", rotulo: t.atencao.verContas });
  if (inicio.atencao.pedidosDeRamo > 0) itens.push({ chave: "pedidos", ...t.atencao.pedidosDeRamo(inicio.atencao.pedidosDeRamo), href: "/admin/nichos", rotulo: t.atencao.verRamos });
  return itens;
}

function Etapa({ certo, falhou, children }: { certo?: boolean; falhou?: boolean; children: ReactNode }) {
  const classe = [styles.etapa, certo ? styles.certo : "", falhou ? styles.falhou : ""].filter(Boolean).join(" ");
  return (
    <span className={classe} data-estado={falhou ? "falhou" : certo ? "certo" : "neutro"}>
      {certo ? <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
      {falhou ? <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

function passo(estado: string, textoOk: string): ReactNode {
  if (estado === "erro") return <Etapa falhou>{t.madrugada.deuErro}</Etapa>;
  if (estado === "sem_execucao") return <Etapa>{t.madrugada.aindaNaoRodou}</Etapa>;
  return <Etapa certo>{textoOk}</Etapa>;
}

function CelulasDoRamo({ linha }: { linha: LinhaDaMadrugada }) {
  return (
    <>
      <td className={[styles.forte, styles.corta].join(" ")}>{linha.nome}</td>
      <td data-celula="busca">{passo(linha.busca.estado, t.madrugada.videos(linha.busca.novos))}</td>
      <td data-celula="transcricao">{passo(linha.transcricao.estado, t.madrugada.transcritos(linha.transcricao.transcritos))}</td>
      <td data-celula="analise">
        <Etapa certo>{linha.analise.analisados}</Etapa>
      </td>
      <td data-celula="temas">
        {linha.temas.quantos > 0 ? <Etapa certo>{linha.temas.quantos}</Etapa> : linha.temas.atrasado ? <Etapa falhou>{t.madrugada.naoSaiu}</Etapa> : <Etapa>{t.madrugada.aindaNao}</Etapa>}
      </td>
    </>
  );
}

function Titulo({ id, titulo, legenda, href, rotulo }: { id: string; titulo: string; legenda?: string; href: string; rotulo: string }) {
  return (
    <div className={styles.tabelaTitulo}>
      <h2 id={id}>{titulo}</h2>
      {legenda ? <span className={styles.quantos}>{legenda}</span> : null}
      <Link className={[styles.botaoTexto, styles.verTodos].join(" ")} href={href}>
        {rotulo}
      </Link>
    </div>
  );
}

function Numero({ chave, rotulo, valor, atencao }: { chave: string; rotulo: string; valor: number; atencao?: boolean }) {
  return (
    <div className={styles.dado} data-numero={chave}>
      <dt>{rotulo}</dt>
      <dd className={atencao && valor > 0 ? styles.atencaoNum : undefined}>{valor}</dd>
    </div>
  );
}

/** `/admin`: o Início, a tela da manhã (E46 PR 1, `AdminInicio.dc.html`): o que pede atenção, a madrugada, os erros, o dinheiro, as contas e o produto. */
export default async function InicioDoAdmin() {
  await exigirAdmin();
  const inicio = await inicioDoAdmin();
  const itens = itensDeAtencao(inicio);
  const { madrugada, dinheiro } = inicio;
  const semTemasAinda = madrugada.linhas.filter((l) => l.temas.quantos === 0).length;
  const tudoCerto = itens.length === 0 && madrugada.totalDeRamos > 0 && semTemasAinda === 0;
  const linhasVisiveis = madrugada.totalDeRamos <= RAMOS_POR_LINHA ? madrugada.linhas : madrugada.comProblema;
  const gastoHojeBrl = usdParaBrl(dinheiro.saiuHojeUsd);

  return (
    <div className={styles.pagina}>
      <div className={styles.topo}>
        <h1>{t.titulo}</h1>
        <span className={styles.linhaDoDia}>{t.linhaDoDia(dataEHoraPorExtenso(inicio.agora), inicio.contas.ativas, madrugada.totalDeRamos)}</span>
      </div>

      <div className={styles.inicio}>
        <div className={styles.pilha}>
          <section className={[styles.cartao, styles.estadoManha].join(" ")} aria-label={t.estado.aria} data-bloco="estado">
            <p className={[styles.fraseEstado, tudoCerto ? styles.fraseCerta : styles.fraseAtencao].join(" ")} data-estado={tudoCerto ? "certo" : "atencao"}>
              {tudoCerto ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
              {tudoCerto ? t.estado.certo : itens.length === 0 ? t.estado.nadaAindaMas : t.estado.atencao(itens.length)}
            </p>
            {tudoCerto ? (
              <p className={styles.tudoCertoLinha}>{t.estado.tudoCertoLinha(madrugada.totalDeRamos)}</p>
            ) : itens.length === 0 ? (
              <p className={styles.tudoCertoLinha}>{t.estado.aindaSemTemas(semTemasAinda, madrugada.totalDeRamos)}</p>
            ) : (
              <ul className={styles.listaAtencao}>
                {itens.map((item) => (
                  <li key={item.chave} className={styles.itemAtencao} data-atencao={item.chave}>
                    <AlertTriangle aria-hidden="true" />
                    <span className={styles.oque}>
                      <strong>{item.titulo}</strong>
                      <span className={styles.quando}>{item.detalhe}</span>
                    </span>
                    <Link className={styles.botaoVazio} href={item.href}>
                      {item.rotulo}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.cartao} aria-labelledby="t-madrugada" data-bloco="madrugada">
            <Titulo id="t-madrugada" titulo={t.madrugada.titulo} legenda={t.madrugada.legenda} href="/admin/jobs" rotulo={t.madrugada.verRotinas} />
            {madrugada.totalDeRamos === 0 ? (
              <p className={styles.semDado}>{t.madrugada.vazio}</p>
            ) : (
              <>
                <p className={styles.resumoRamos} data-resumo="ramos">
                  <span>
                    <b>{madrugada.ok}</b> {t.madrugada.resumoOk(madrugada.ok)}
                  </span>
                  <span>
                    <b>{madrugada.comProblema.length}</b> {t.madrugada.resumoProblema}
                  </span>
                </p>
                {linhasVisiveis.length > 0 ? (
                  <div className={styles.tabelaArea}>
                    <table className={[styles.tabela, styles.tabelaCompacta].join(" ")}>
                      <thead>
                        <tr>
                          <th scope="col">{t.madrugada.colunas.ramo}</th>
                          <th scope="col">{t.madrugada.colunas.busca}</th>
                          <th scope="col">{t.madrugada.colunas.transcricao}</th>
                          <th scope="col">{t.madrugada.colunas.analise}</th>
                          <th scope="col">{t.madrugada.colunas.temas}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhasVisiveis.map((linha) => (
                          <tr key={linha.nichoId} data-ramo={linha.nichoId}>
                            <CelulasDoRamo linha={linha} />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className={styles.cartao} aria-labelledby="t-erros" data-bloco="erros">
            <Titulo id="t-erros" titulo={t.erros.titulo} legenda={t.erros.hoje(inicio.erros.hoje)} href="/admin/jobs" rotulo={t.erros.verTodos} />
            {inicio.erros.recentes.length === 0 ? (
              <p className={styles.semDado}>{t.erros.nenhum}</p>
            ) : (
              <ul className={styles.errosRecentes}>
                {inicio.erros.recentes.map((erro) => (
                  <li key={erro.id} className={styles.erroRecente} data-erro={erro.id}>
                    <span className={styles.oqueErro}>{t.erros.frase(erro.nome, erro.mensagem.length > 160 ? `${erro.mensagem.slice(0, 160)}...` : erro.mensagem)}</span>
                    <span className={styles.onde}>{quandoPorExtenso(erro.quando, inicio.agora)}</span>
                    <span className={[styles.etiqueta, erro.continua ? styles.etiquetaAtencao : styles.etiquetaAtiva].join(" ")}>{erro.continua ? t.erros.continua : t.erros.resolvido}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className={styles.pilha}>
          <section className={[styles.cartao, styles.dinheiro].join(" ")} aria-labelledby="t-dinheiro" data-bloco="dinheiro">
            <Titulo id="t-dinheiro" titulo={t.dinheiro.titulo} href="/admin/geracoes" rotulo={t.dinheiro.verCustos} />
            <div className={styles.linhaDinheiro}>
              <span className={styles.rotulo}>{t.dinheiro.saiuHoje}</span>
              <div className={styles.valorDinheiro} data-dinheiro="hoje">
                <b>{reais(gastoHojeBrl)}</b>
                <span>{t.dinheiro.saiuHojeDetalhe(dolares(dinheiro.saiuHojeUsd), reais(TETO_DIARIO_BRL))}</span>
              </div>
              <span className={styles.barraMeta}>
                <i style={{ width: `${Math.min(100, (gastoHojeBrl / TETO_DIARIO_BRL) * 100)}%`, background: dinheiro.passouDoTeto ? "var(--cor-atencao)" : undefined }} />
              </span>
            </div>
            <div className={styles.linhaDinheiro}>
              <span className={styles.rotulo}>{t.dinheiro.saiu30}</span>
              <div className={styles.valorDinheiro} data-dinheiro="30dias">
                <b>{reais(dinheiro.saiu30dComFixosBrl)}</b>
                <span>{t.dinheiro.saiu30Detalhe(reais(usdParaBrl(dinheiro.saiu30dUsd)), reais(CUSTO_FIXO_MENSAL_BRL))}</span>
              </div>
            </div>
            <div className={styles.linhaDinheiro}>
              <span className={styles.rotulo}>{t.dinheiro.entrou30}</span>
              <p className={styles.semCobranca}>{t.dinheiro.semCobranca}</p>
            </div>
            <div className={[styles.linhaDinheiro, styles.resultado].join(" ")}>
              <span className={styles.rotulo}>{t.dinheiro.resultado30}</span>
              <div className={styles.valorDinheiro} data-dinheiro="resultado">
                <b>{t.dinheiro.menos(reais(dinheiro.saiu30dComFixosBrl))}</b>
              </div>
            </div>
            <p className={styles.cambio}>{t.dinheiro.cambio(CAMBIO_USD_BRL.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), CAMBIO_DATA_TEXTO)}</p>
          </section>

          <section className={styles.cartao} aria-labelledby="t-contas" data-bloco="contas">
            <Titulo id="t-contas" titulo={t.contas.titulo} href="/admin/clientes" rotulo={t.contas.verContas} />
            <dl className={styles.numerosBloco}>
              <Numero chave="ativas" rotulo={t.contas.ativas} valor={inicio.contas.ativas} />
              <Numero chave="usaram-ontem" rotulo={t.contas.usaramOntem} valor={inicio.contas.usaramOntem} />
              <Numero chave="pararam" rotulo={t.contas.pararam} valor={inicio.contas.pararam} atencao />
              <Numero chave="briefing-incompleto" rotulo={t.contas.briefingIncompleto} valor={inicio.contas.briefingIncompleto} />
              <Numero chave="novas" rotulo={t.contas.novas} valor={inicio.contas.novasNaSemana} />
            </dl>
          </section>

          <section className={styles.cartao} aria-labelledby="t-produto" data-bloco="produto">
            <Titulo id="t-produto" titulo={t.produto.titulo} href="/admin/geracoes" rotulo={t.produto.verGeracoes} />
            <dl className={styles.numerosBloco}>
              <Numero chave="escritos" rotulo={t.produto.escritos} valor={inicio.produto.escritos} />
              <Numero chave="gravados" rotulo={t.produto.gravados} valor={inicio.produto.gravados} />
              <Numero chave="postados" rotulo={t.produto.postados} valor={inicio.produto.postados} />
              <Numero chave="reprovados" rotulo={t.produto.reprovados} valor={inicio.produto.reprovados} />
            </dl>
            <p className={styles.cambio}>{inicio.produto.motivoMaisComum ? t.produto.motivo(inicio.produto.motivoMaisComum.rotulo, inicio.produto.motivoMaisComum.vezes, inicio.produto.reprovados) : t.produto.semReprovacao}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
