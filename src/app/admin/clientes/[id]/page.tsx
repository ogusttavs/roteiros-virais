import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CAMBIO_USD_BRL } from "@/config/dinheiro";
import { rotuloDoMotivo } from "@/config/motivos-reprovacao";
import { idDaRotaOuNulo } from "@/lib/id-rota";
import { exigirAdmin } from "@/lib/sessao";
import { META_CUSTO_CLIENTE_USD, clienteDetalheAdmin } from "@/servicos/admin-coleta";
import { alteracoesDaConta, pessoasDaConta, usoDosUltimosDias } from "@/servicos/admin-contas";
import { descreverPublico } from "@/servicos/admin-trocas";
import { contarReprovacoes, regrasDoCliente } from "@/servicos/aprendizado";
import { clientePorId, membrosDaMarca, NOME_SEM_NOME_AINDA } from "@/servicos/clientes";
import { fontesDoHistorico } from "@/servicos/curva";
import { formatosDaMarcaComEstado } from "@/servicos/formatos";
import { ramoAtualDoCliente } from "@/servicos/ramos";
import { ramosAlternativosDaMarca } from "@/servicos/ramos-da-conta";
import { roteirosDoCliente } from "@/servicos/roteiro";
import { pessoasVisiveis, ultimasEntradasVerComo } from "@/servicos/ver-como";
import { textosAdmin } from "@/textos/admin";
import { dolares, quandoPorExtenso, reais, textosContaAdmin as t } from "@/textos/admin-contas";
import { textosHistorico } from "@/textos/historico";

import comum from "../../comum.module.css";

import conta from "./conta.module.css";
import { IdentidadeAdmin } from "./IdentidadeAdmin";
import antigo from "./page.module.css";
import { QuemTemAcessoAdmin } from "./QuemTemAcessoAdmin";
import { RamosAlternativosAdmin } from "./RamosAlternativosAdmin";
import { SeletorPlanoAdmin } from "./SeletorPlanoAdmin";
import { TiposDeVideoAdmin } from "./TiposDeVideoAdmin";

const td = textosAdmin.clienteDetalhe;
const LIMIAR_ATENCAO = 5;
const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function formatarNota(nota: number | null): string {
  if (nota === null) return textosAdmin.clientes.semNota;
  return nota.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarData(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
}

/**
 * `/admin/clientes/[id]`: a página da conta em blocos (E46 PR 1, `AdminCliente.dc.html`): Identidade (com as trocas que antes exigiam o banco), Briefing, Quem tem acesso, Ajustes
 * e Uso. Fica na rota de sempre; só os nomes mudam ("Contas"). O "ver como" é do PR 2.
 */
export default async function AdminContaDetalhe({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();

  const { id } = await params;
  const clienteId = idDaRotaOuNulo(id);
  if (clienteId === null) notFound();

  const detalhe = await clienteDetalheAdmin(clienteId);
  if (!detalhe) notFound();
  const cliente = (await clientePorId(clienteId))!;

  const roteiros = await roteirosDoCliente(detalhe.id, 50);
  const roteirosPostadosIds = roteiros.filter((r) => r.status === "postado").map((r) => r.id);
  const fontes = await fontesDoHistorico(detalhe.id, roteirosPostadosIds);
  const regras = await regrasDoCliente(detalhe.id);
  const totalReprovacoes = await contarReprovacoes(detalhe.id);
  const regrasAtivas = regras.filter((regra) => regra.ativa).length;
  const membrosBrutos = await membrosDaMarca(detalhe.id);
  const pessoas = await pessoasDaConta(detalhe.id);
  const principal = await ramoAtualDoCliente(cliente.nichoId);
  const alternativos = await ramosAlternativosDaMarca(detalhe.id);
  const tiposDaMarca = await formatosDaMarcaComEstado(detalhe.id);
  const diaADia = await usoDosUltimosDias(detalhe.id, 14);
  const alteracoes = await alteracoesDaConta(detalhe.id, 8);
  const diaPorExtenso = (d: Date) => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(d);
  // Server Component: NOME_SEM_NOME_AINDA mora num arquivo que importa next/headers, que só pode ser importado aqui (o client component recebe só o booleano já calculado).
  const visiveis = new Set((await pessoasVisiveis(detalhe.id)).map((p) => p.usuarioId));
  const entradasVerComo = await ultimasEntradasVerComo(detalhe.id);
  const membros = membrosBrutos.map((membro) => ({ ...membro, semNome: membro.nome === NOME_SEM_NOME_AINDA, podeVerComo: visiveis.has(membro.usuarioId) }));
  const escondidos = [principal?.ramoSlug, ...alternativos.map((a) => a.ramoSlug)].filter((s): s is string => Boolean(s));
  const publicoTexto = cliente.alcance ? descreverPublico(cliente) : "";
  const agora = new Date();
  const desde = diaPorExtenso(detalhe.criadoEm);
  const nota = detalhe.briefing?.notaGeral ?? null;

  return (
    <div className={comum.pagina}>
      <Link href="/admin/clientes" className={conta.voltar}>
        <ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" /> {t.voltar}
      </Link>

      <div className={comum.topo}>
        <div className={comum.titulos}>
          <h1>{detalhe.nome}</h1>
          <span className={comum.linhaDoDia}>
            {detalhe.tipo === "pessoa" ? "perfil pessoal" : "perfil de empresa"}, {principal?.nome ?? textosAdmin.clientes.semNicho}, desde {desde}, {textosAdmin.acessos.quantos(membros.length)}
          </span>
        </div>
      </div>

      <div className={conta.blocos}>
        <div className={conta.pilha}>
          <section className={comum.cartao} aria-labelledby="b-identidade" data-bloco="identidade">
            <div className={comum.tabelaTitulo}>
              <h2 id="b-identidade">{t.blocos.identidade}</h2>
            </div>
            <IdentidadeAdmin
              clienteId={detalhe.id}
              nome={detalhe.nome}
              tipo={cliente.tipo}
              ramo={principal ? { nome: principal.nome, slug: principal.ramoSlug } : null}
              rede={cliente.redePrincipal}
              publico={{ alcance: cliente.alcance, regiao: cliente.regiao, pais: cliente.pais, paises: cliente.paises }}
              publicoTexto={publicoTexto}
              ramosEscondidos={escondidos}
            />
          </section>

          <section className={comum.cartao} aria-labelledby="b-briefing" data-bloco="briefing">
            <div className={comum.tabelaTitulo}>
              <h2 id="b-briefing">{t.blocos.briefing}</h2>
              <span className={comum.quantos}>{detalhe.briefing ? (detalhe.briefing.completo ? t.briefing.estadoCompleto : t.briefing.estadoIncompleto) : t.briefing.semBriefing}</span>
            </div>
            {detalhe.briefing ? (
              <div className={conta.notaBriefing}>
                <span className={[conta.valor, nota !== null && nota < 8 ? conta.abaixo : ""].filter(Boolean).join(" ")}>{formatarNota(nota)}</span>
                <span className={conta.meta}>nota geral, meta 8,0</span>
              </div>
            ) : (
              <p className={comum.semDado}>{td.semBriefing}</p>
            )}
            {detalhe.briefing?.resumo ? <p className={conta.resumo}>{detalhe.briefing.resumo}</p> : null}
          </section>
        </div>

        <div className={conta.pilha}>
          <section className={comum.cartao} data-bloco="acesso">
            <QuemTemAcessoAdmin clienteId={detalhe.id} nomeMarca={detalhe.nome} membros={membros} />
            {/* E46 PR 2, regra 4: as últimas entradas no "ver como" desta conta. */}
            <div className={conta.registroVerComo} data-bloco="ver-como">
              <h3>{textosAdmin.acessos.verComoRegistroTitulo}</h3>
              {entradasVerComo.length === 0 ? (
                <p className={comum.semDado}>{textosAdmin.acessos.verComoRegistroVazio}</p>
              ) : (
                <ul>
                  {entradasVerComo.map((e) => {
                    const t0 = textosAdmin.acessos.verComoDuracao;
                    const aberto = e.saiuEm === null && e.expiraEm.getTime() > agora.getTime();
                    const minutos = e.saiuEm ? Math.max(0, Math.round((e.saiuEm.getTime() - e.entrouEm.getTime()) / 60000)) : 0;
                    const duracao = aberto
                      ? t0.aberto
                      : e.motivoSaida === "saiu"
                        ? t0.saiu(minutos)
                        : e.motivoSaida === "trocou"
                          ? t0.trocou
                          : e.motivoSaida === "sessao"
                            ? t0.sessao
                            : t0.expirou;
                    return (
                      <li key={e.id}>{textosAdmin.acessos.verComoRegistroLinha(e.pessoaNome, quandoPorExtenso(e.entrouEm, agora), duracao)}</li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className={comum.cartao} aria-labelledby="b-ajustes" data-bloco="ajustes">
            <div className={comum.tabelaTitulo}>
              <h2 id="b-ajustes">{t.blocos.ajustes}</h2>
            </div>
            <div className={conta.ajustes}>
              <div className={conta.linhaAjuste}>
                <SeletorPlanoAdmin clienteId={detalhe.id} planoInicial={detalhe.plano} />
              </div>
              <div className={conta.linhaAjuste} data-ajuste="teto">
                <span className={conta.rotuloAjuste}>{t.ajustes.tetoDoMes}</span>
                <span className={conta.valorAjuste}>{t.ajustes.tetoDoMesTexto(dolares(META_CUSTO_CLIENTE_USD), reais(META_CUSTO_CLIENTE_USD * CAMBIO_USD_BRL))}</span>
                <p className={conta.notaDeAjuste}>{t.ajustes.tetoNota}</p>
              </div>
              <TiposDeVideoAdmin
                clienteId={detalhe.id}
                nomeMarca={detalhe.nome}
                iniciais={tiposDaMarca.map((x) => ({
                  chave: x.chave,
                  ligada: x.ligada,
                  quem: x.quem,
                  respostaDoCliente: x.respostaDoCliente,
                  decididoEmTexto: x.decididoEm ? diaPorExtenso(x.decididoEm) : null,
                  respostaDoClienteEmTexto: x.respostaDoClienteEm ? diaPorExtenso(x.respostaDoClienteEm) : null,
                }))}
              />
              <RamosAlternativosAdmin
                clienteId={detalhe.id}
                nomeMarca={detalhe.nome}
                principal={principal ? { nome: principal.nome, slug: principal.ramoSlug } : null}
                alternativos={alternativos.map((a) => ({ id: a.id, nome: a.nome, slug: a.ramoSlug, ligadoEm: a.ligadoEm.toISOString() }))}
              />
              <div className={conta.linhaAjuste} data-registro>
                <span className={comum.rotulo}>{t.registro.titulo}</span>
                {alteracoes.length === 0 ? (
                  <p className={conta.notaDeAjuste}>{t.registro.vazio}</p>
                ) : (
                  <ul className={conta.registro}>
                    {alteracoes.map((a) => (
                      <li key={a.id}>
                        <span>{t.registro.frase(t.registro.campo[a.campo] ?? a.campo, a.antes, a.depois)}</span>
                        <span className={conta.quando}>
                          {t.registro.quem(a.porNome)}, {quandoPorExtenso(a.em, agora)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className={[comum.cartao, conta.areaUso].join(" ")} aria-labelledby="b-uso" data-bloco="uso">
          <div className={comum.tabelaTitulo}>
            <h2 id="b-uso">{t.blocos.uso}</h2>
          </div>
          <div className={conta.usoDentro}>
            <div className={conta.parteUso}>
              <dl className={conta.numerosUso}>
                <div className={comum.dado} data-uso="roteiros">
                  <dt>{t.uso.roteiros}</dt>
                  <dd data-numero>{roteiros.length}</dd>
                </div>
                <div className={comum.dado} data-uso="ultimo">
                  <dt>{t.uso.ultimo}</dt>
                  <dd>{roteiros[0] ? formatarData(roteiros[0].data) : textosAdmin.clientes.semRoteiro}</dd>
                </div>
                <div className={comum.dado} data-uso="sem-gravar">
                  <dt>{t.uso.semGravar}</dt>
                  <dd data-numero className={detalhe.diasSemGravar !== null && detalhe.diasSemGravar >= LIMIAR_ATENCAO ? antigo.textoAtencao : undefined}>{detalhe.diasSemGravar ?? "-"}</dd>
                </div>
                <div className={comum.dado} data-uso="reprovou">
                  <dt>{t.uso.reprovou}</dt>
                  <dd data-numero>{totalReprovacoes}</dd>
                </div>
              </dl>
            </div>

            <div className={conta.parteUso}>
              <h3>{t.uso.diaADia}</h3>
              <div className={conta.diaADiaArea}>
                <table className={conta.diaADia} data-dia-a-dia>
                  <caption>{t.uso.diaADiaLegenda}</caption>
                  <thead>
                    <tr>
                      {diaADia.map((d, i) => (
                        <th key={d.dia} scope="col" className={i === diaADia.length - 1 ? conta.hoje : undefined}>
                          {DIAS_CURTOS[new Date(`${d.dia}T12:00:00Z`).getUTCDay()].slice(0, 1)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {diaADia.map((d) => (
                        <td key={d.dia} title={`${formatarData(d.dia)}: ${d.gravados > 0 ? "gravou" : d.escritos > 0 ? "gerou roteiro" : "nada"}`} data-dia={d.dia} data-estado={d.gravados > 0 ? "gravou" : d.escritos > 0 ? "gerou" : "nada"}>
                          <i role="img" aria-label={`${formatarData(d.dia)}: ${d.gravados > 0 ? "gravou" : d.escritos > 0 ? "gerou roteiro" : "nada"}`} className={d.gravados > 0 ? conta.gravou : d.escritos > 0 ? conta.gerou : undefined} />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className={conta.legendaUso}>
                <span>
                  <i className={conta.gravou} />
                  gravou
                </span>
                <span>
                  <i className={conta.gerou} />
                  gerou roteiro
                </span>
                <span>
                  <i />
                  nada
                </span>
              </p>
              <h3>{t.uso.entradas}</h3>
              <ul className={conta.entradas}>
                {pessoas.map((p) => (
                  <li key={p.usuarioId}>
                    <span>{p.nome}</span>
                    <span className={conta.quando}>{p.ultimoAcessoEm ? quandoPorExtenso(p.ultimoAcessoEm, agora) : t.uso.nuncaEntrou}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className={[conta.parteUso, conta.roteirosCliente].join(" ")}>
              <h3>{td.roteirosTitulo}</h3>
              {roteiros.length === 0 ? (
                <p className={antigo.semDado}>{td.vazioRoteiros}</p>
              ) : (
                <div className={antigo.tabelaEnvoltorio}>
                  <table className={antigo.tabela}>
                    <thead>
                      <tr>
                        <th>{td.colunaData}</th>
                        <th>{td.colunaTema}</th>
                        <th>{td.colunaStatus}</th>
                        <th>{td.colunaFonte}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roteiros.map((roteiro) => {
                        const fonte = fontes.get(roteiro.id);
                        return (
                          <tr key={roteiro.id}>
                            <td className={antigo.mono}>{formatarData(roteiro.data)}</td>
                            <td>{roteiro.tema}</td>
                            <td>{textosHistorico.status[roteiro.status]}</td>
                            <td className={antigo.mono}>{fonte ? td.fonteRotulo[fonte] : "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className={conta.parteUso} aria-label={td.aprendizadoTitulo}>
              <div className={antigo.cabecalhoAprendizado}>
                <h3>{td.aprendizadoTitulo}</h3>
                {regras.length > 0 ? <span className={antigo.quantos}>{td.aprendizadoQuantos(totalReprovacoes, regrasAtivas)}</span> : null}
              </div>
              {regras.length === 0 ? (
                <p className={antigo.semDado}>{td.aprendizadoVazio}</p>
              ) : (
                <>
                  <div className={antigo.regras}>
                    {regras.map((regra) => (
                      <div key={regra.id} className={[antigo.regra, !regra.ativa ? antigo.regraDesativada : ""].filter(Boolean).join(" ")}>
                        <span className={antigo.oque}>{regra.regra}</span>
                        <span className={[antigo.etiqueta, regra.ativa ? antigo.etiquetaAtiva : ""].filter(Boolean).join(" ")}>{regra.ativa ? td.aprendizadoEtiquetaAtiva : td.aprendizadoEtiquetaDesativada}</span>
                        <span className={antigo.deOnde}>
                          {regra.ativa ? td.aprendizadoDeOnde(regra.contagem, regra.ultimaEm, regra.motivoOrigem ? rotuloDoMotivo(regra.motivoOrigem) : null) : td.aprendizadoDesativadaEm(regra.desativadaEm ?? regra.ultimaEm)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className={antigo.rodape}>{td.aprendizadoRodape}</p>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
