"use client";

import { AlertTriangle, CheckCircle2, Search, User, Users } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";

import type { ContaAdmin, EstadoDoDia } from "@/servicos/admin-contas";
import { textosContasAdmin as t } from "@/textos/admin-contas";
import { Botao } from "@/ui/componentes/Botao";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import comum from "../comum.module.css";

import proprio from "./contas.module.css";
import { ModalNovaMarca } from "./ModalNovaMarca";

const styles = { ...comum, ...proprio };

export type FiltroDeContas = "todas" | "usando" | "parou" | "nao_entrou";

const FILTROS: { chave: FiltroDeContas; rotulo: string; doQue: string }[] = [
  { chave: "todas", rotulo: t.filtros.todas, doQue: t.filtros.doQueTodas },
  { chave: "usando", rotulo: t.filtros.usando, doQue: t.filtros.doQueUsando },
  { chave: "parou", rotulo: t.filtros.parou, doQue: t.filtros.doQueParou },
  { chave: "nao_entrou", rotulo: t.filtros.naoEntrou, doQue: t.filtros.doQueNaoEntrou },
];

/** Sem acento e sem maiúscula, para "clinica" achar "Clínica". */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function noFiltro(conta: ContaAdmin, filtro: FiltroDeContas): boolean {
  if (filtro === "usando") return conta.usando;
  if (filtro === "parou") return conta.parou;
  if (filtro === "nao_entrou") return conta.nuncaEntrou;
  return true;
}

/** A conta casa com a busca pelo nome dela, pelo ramo, ou pelo nome ou e-mail de qualquer pessoa com acesso. */
export function casaComABusca(conta: ContaAdmin, busca: string): boolean {
  const termo = normalizar(busca);
  if (!termo) return true;
  if (normalizar(conta.nome).includes(termo) || normalizar(conta.ramoNome ?? "").includes(termo)) return true;
  return conta.quemTemAcesso.some((p) => normalizar(p.nome).includes(termo) || normalizar(p.email).includes(termo));
}

function Marcado({ texto, busca }: { texto: string; busca: string }): ReactNode {
  const termo = normalizar(busca);
  if (!termo) return texto;
  const alvo = normalizar(texto);
  const i = alvo.indexOf(termo);
  // A normalização só remove acentos combinados e troca caixa: o tamanho do texto não muda, então o mesmo recorte vale para os dois.
  if (i < 0 || alvo.length !== texto.length) return texto;
  return (
    <>
      {texto.slice(0, i)}
      <mark>{texto.slice(i, i + termo.length)}</mark>
      {texto.slice(i + termo.length)}
    </>
  );
}

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function diaDaSemana(iso: string): string {
  return DIAS_CURTOS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

function formatarNota(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dataCurta(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "America/Sao_Paulo" }).format(d).replace(".", "");
}

function CelulaDoBriefing({ conta }: { conta: ContaAdmin }) {
  const b = conta.briefingEstado;
  if (b.tipo === "pronto" && !b.abaixo) {
    return (
      <span className={styles.marcaSim} data-briefing="pronto">
        <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" />
        {formatarNota(b.nota)}
      </span>
    );
  }
  return (
    <span className={styles.marcaNao} data-briefing={b.tipo}>
      <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
      {b.tipo === "pronto" ? `${formatarNota(b.nota)}, abaixo` : b.tipo === "incompleto" ? `incompleto, ${b.respondidas} de 12` : "sem briefing"}
    </span>
  );
}

function SemanaDeUso({ conta }: { conta: ContaAdmin }) {
  const frase = t.semana(conta.ultimos7.map((d) => `${diaDaSemana(d.dia)}: ${t.estados[d.estado]}`));
  return (
    <span className={styles.semanaUso} role="img" aria-label={frase} data-semana={conta.ultimos7.map((d) => d.estado).join(" ")}>
      {conta.ultimos7.map((d) => (
        <i key={d.dia} className={d.estado === "nada" ? undefined : styles[d.estado]} />
      ))}
    </span>
  );
}

type Props = {
  contas: ContaAdmin[];
  nichos: { id: number; nome: string }[];
  filtroInicial?: FiltroDeContas;
};

export function TabelaContas({ contas, nichos, filtroInicial = "todas" }: Props) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroDeContas>(filtroInicial);
  const [modalAberto, setModalAberto] = useState(false);

  const contagens = useMemo(() => ({ todas: contas.length, usando: contas.filter((c) => c.usando).length, parou: contas.filter((c) => c.parou).length, nao_entrou: contas.filter((c) => c.nuncaEntrou).length }), [contas]);

  const visiveis = useMemo(() => contas.filter((c) => noFiltro(c, filtro) && casaComABusca(c, busca)), [contas, filtro, busca]);

  // "Bruno Cardoso entra em 2 contas": a pessoa que a busca achou e que aparece em mais de uma conta (cada conta continua na lista, uma por linha).
  const pessoasEmVariasContas = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return [];
    const porPessoa = new Map<string, { nome: string; email: string; contas: number }>();
    for (const c of contas) {
      for (const p of c.quemTemAcesso) {
        if (!(normalizar(p.nome).includes(termo) || normalizar(p.email).includes(termo))) continue;
        const atual = porPessoa.get(p.usuarioId);
        porPessoa.set(p.usuarioId, { nome: p.nome, email: p.email, contas: (atual?.contas ?? 0) + 1 });
      }
    }
    return [...porPessoa.values()].filter((p) => p.contas > 1);
  }, [contas, busca]);

  const pessoas = useMemo(() => new Set(contas.flatMap((c) => c.quemTemAcesso.map((p) => p.usuarioId))).size, [contas]);

  return (
    <div className={styles.pagina}>
      <div className={styles.topo}>
        <div className={styles.titulos}>
          <h1>{t.titulo}</h1>
          <span className={styles.linhaDoDia}>
            {t.subtitulo(contas.length)}, {pessoas === 1 ? "1 pessoa" : `${pessoas} pessoas`}
            {contagens.nao_entrou > 0 ? `, ${contagens.nao_entrou === 1 ? "1 conta sem primeiro acesso" : `${contagens.nao_entrou} contas sem primeiro acesso`}` : ""}
          </span>
        </div>
        <div className={styles.acoesTopo}>
          <Botao onClick={() => setModalAberto(true)}>{t.novaConta}</Botao>
        </div>
      </div>

      {contas.length > 0 ? (
        <section className={styles.visaoContas} aria-label={t.filtros.aria}>
          <div className={styles.contadores}>
            {FILTROS.map((f) => (
              <button key={f.chave} type="button" className={styles.contador} aria-pressed={filtro === f.chave} data-filtro={f.chave} onClick={() => setFiltro(f.chave)}>
                <span className={styles.valor}>{contagens[f.chave]}</span>
                <span className={styles.doQue}>
                  <b>{f.rotulo}</b> {f.doQue}
                </span>
              </button>
            ))}
          </div>
          <p className={styles.legendaUso}>
            {(["gravou", "gerou", "entrou", "nada"] as EstadoDoDia[]).map((e) => (
              <span key={e}>
                <i className={e === "nada" ? undefined : styles[e]} />
                {t.legenda[e]}
              </span>
            ))}
          </p>
        </section>
      ) : null}

      {contas.length > 0 ? (
        <div className={styles.filtros}>
          <label className={styles.busca}>
            <Search size={18} strokeWidth={1.5} aria-hidden="true" />
            <input type="search" placeholder={t.buscar} aria-label={t.buscar} value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
        </div>
      ) : null}

      {pessoasEmVariasContas.map((p) => (
        <p key={p.email} className={styles.achadosPessoa} data-pessoa-em-varias={p.email}>
          <User size={18} strokeWidth={1.5} aria-hidden="true" />
          <span>
            <b>{p.nome}</b> ({p.email}) entra em {p.contas} contas.
          </span>
        </p>
      ))}

      {contas.length === 0 ? (
        <EstadoVazio icone={<Users size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : visiveis.length === 0 ? (
        <div className={[styles.cartao, styles.vazio].join(" ")}>
          <h3>{busca.trim() ? `Nenhuma conta ou pessoa com "${busca.trim()}"` : t.semNoFiltro}</h3>
          <p className={styles.semDado}>{busca.trim() ? t.semResultado : ""}</p>
        </div>
      ) : (
        <div className={styles.tabelaArea}>
          <table className={[styles.tabela, styles.tabelaContas].join(" ")}>
            <thead>
              <tr>
                <th scope="col">{t.colunas.conta}</th>
                <th scope="col">{t.colunas.pessoas}</th>
                <th scope="col">{t.colunas.briefing}</th>
                <th scope="col">{t.colunas.ultimos7}</th>
                <th scope="col">{t.colunas.ultimo}</th>
                <th scope="col">{t.colunas.instalou}</th>
                <th scope="col">{t.colunas.push}</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((conta) => {
                const [primeira, ...outras] = conta.quemTemAcesso;
                return (
                  <tr key={conta.id} data-conta={conta.id}>
                    <td className={[styles.forte, styles.nomeCliente].join(" ")}>
                      <Link className={styles.celulaLink} href={`/admin/clientes/${conta.id}`}>
                        <span>
                          <Marcado texto={conta.nome} busca={busca} />
                        </span>
                      </Link>
                      <span className={styles.subConta}>
                        <span className={styles.tipoConta} data-tipo={conta.tipo}>
                          {t.tipo[conta.tipo].toLowerCase()}
                        </span>
                        <span className={styles.ramoConta}>{conta.ramoNome ?? t.semRamo}</span>
                      </span>
                    </td>
                    <td className={styles.pessoasCelula}>
                      {primeira ? (
                        <Fragment>
                          <span className={styles.nomePessoa}>
                            <Marcado texto={primeira.nome} busca={busca} />
                            {outras.length > 0 ? <span className={styles.maisPessoas}>{`mais ${outras.length}`}</span> : null}
                          </span>
                          <span className={styles.emailPessoa}>
                            <Marcado texto={primeira.email} busca={busca} />
                          </span>
                        </Fragment>
                      ) : (
                        <span className={styles.detalhePessoa}>{t.semPessoa}</span>
                      )}
                    </td>
                    <td>
                      <CelulaDoBriefing conta={conta} />
                    </td>
                    <td>
                      <SemanaDeUso conta={conta} />
                    </td>
                    <td className={styles.ultimoCelula}>
                      <span>{conta.ultimoRoteiro ? dataCurta(conta.ultimoRoteiro) : "sem roteiro"}</span>
                      <span className={[styles.semGravar, conta.diasSemGravar !== null && conta.diasSemGravar >= 5 ? styles.atencaoNum : ""].filter(Boolean).join(" ")}>
                        {conta.diasSemGravar === null ? (conta.nuncaEntrou ? "ainda não entrou" : t.semRoteiro) : t.semGravar(conta.diasSemGravar)}
                      </span>
                    </td>
                    <td className={styles.mono} data-instalou={conta.instaladoEm ? "sim" : "nao"}>
                      {conta.instaladoEm ? `${dataCurta(conta.instaladoEm)}${conta.instaladoEmSistema ? `, ${t.sistemaDaInstalacao[conta.instaladoEmSistema]}` : ""}` : t.instalouNao}
                    </td>
                    <td className={styles.mono} data-aparelhos-push={conta.aparelhosComPush}>
                      {t.aparelhos(conta.aparelhosComPush)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ModalNovaMarca nichos={nichos} aberto={modalAberto} onFechar={() => setModalAberto(false)} />
    </div>
  );
}
