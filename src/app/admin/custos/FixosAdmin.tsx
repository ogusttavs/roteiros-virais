"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, type FormEvent } from "react";

import { textosCustosAdmin } from "@/textos/admin-custos";
import { Botao } from "@/ui/componentes/Botao";

import { adicionarFixoAction, editarFixoAction, tirarFixoAction } from "./acoes";
import styles from "./custos.module.css";

const t = textosCustosAdmin.fixos;

export type FixoNaTela = { id: number; nome: string; valor: number; moeda: "brl" | "usd"; periodo: "mensal" | "anual"; cobra: string | null; valorTexto: string; porMesTexto: string };

type Rascunho = { id: number | null; nome: string; valor: string; moeda: "brl" | "usd"; periodo: "mensal" | "anual"; cobra: string };

const VAZIO: Rascunho = { id: null, nome: "", valor: "", moeda: "brl", periodo: "mensal", cobra: "" };

function numeroDe(texto: string): number {
  return Number(texto.replace(/\./g, "").replace(",", "."));
}

/** Os fixos (E46 PR 3): cadastro na própria tabela. "Adicionar" e "Editar" abrem a mesma linha de formulário; "Tirar" confirma na linha e não apaga o passado. */
export function FixosAdmin({ fixos, totalTexto, abrirAoMontar = false }: { fixos: FixoNaTela[]; totalTexto: string; abrirAoMontar?: boolean }) {
  const router = useRouter();
  const [rascunho, setRascunho] = useState<Rascunho | null>(abrirAoMontar ? VAZIO : null);
  const [tirando, setTirando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function executar(tarefa: () => Promise<{ ok: boolean; erro?: string }>, aoFim: () => void) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await tarefa();
      if (!r.ok) {
        setErro(r.erro ?? t.erro);
        return;
      }
      aoFim();
      router.refresh();
    } catch {
      setErro(t.erro);
    } finally {
      setOcupado(false);
    }
  }

  function salvar(e: FormEvent) {
    e.preventDefault();
    if (!rascunho) return;
    const dados = { nome: rascunho.nome, valor: numeroDe(rascunho.valor), moeda: rascunho.moeda, periodo: rascunho.periodo, cobra: rascunho.cobra };
    const id = rascunho.id;
    void executar(
      () => (id === null ? adicionarFixoAction(dados) : editarFixoAction(id, dados)),
      () => setRascunho(null),
    );
  }

  const formulario = rascunho ? (
    <tr className={styles.linhaForm} data-form-fixo>
      <td colSpan={5}>
        <form className={styles.formFixo} onSubmit={salvar}>
          <label className={styles.rotuloCampo}>
            {t.campoNome}
            <input className={styles.entrada} value={rascunho.nome} maxLength={80} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} autoFocus />
          </label>
          <label className={styles.rotuloCampo}>
            {t.campoValor}
            <input className={styles.entrada} inputMode="decimal" value={rascunho.valor} onChange={(e) => setRascunho({ ...rascunho, valor: e.target.value })} />
          </label>
          <label className={styles.rotuloCampo}>
            {t.campoMoeda}
            <select className={styles.entrada} value={rascunho.moeda} onChange={(e) => setRascunho({ ...rascunho, moeda: e.target.value as "brl" | "usd" })}>
              <option value="brl">{t.reais}</option>
              <option value="usd">{t.dolares}</option>
            </select>
          </label>
          <label className={styles.rotuloCampo}>
            {t.campoPeriodo}
            <select className={styles.entrada} value={rascunho.periodo} onChange={(e) => setRascunho({ ...rascunho, periodo: e.target.value as "mensal" | "anual" })}>
              <option value="mensal">{t.porMes}</option>
              <option value="anual">{t.porAno}</option>
            </select>
          </label>
          <label className={styles.rotuloCampo}>
            {t.campoCobra}
            <input className={styles.entrada} value={rascunho.cobra} maxLength={120} onChange={(e) => setRascunho({ ...rascunho, cobra: e.target.value })} />
          </label>
          {erro ? (
            <p className={styles.erroCampo} role="alert">
              {erro}
            </p>
          ) : null}
          <div className={styles.acoes}>
            <Botao type="submit" tamanho="md" carregando={ocupado}>
              {t.salvar}
            </Botao>
            <Botao type="button" variante="ghost" tamanho="md" disabled={ocupado} onClick={() => setRascunho(null)}>
              {t.cancelar}
            </Botao>
          </div>
        </form>
      </td>
    </tr>
  ) : null;

  return (
    <div className={styles.fixos}>
      <div className={styles.tabelaArea}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th scope="col">{t.colunas.oque}</th>
              <th scope="col">{t.colunas.valor}</th>
              <th scope="col">{t.colunas.porMes}</th>
              <th scope="col">{t.colunas.cobra}</th>
              <th scope="col">{t.colunas.acoes}</th>
            </tr>
          </thead>
          <tbody>
            {fixos.length === 0 && !rascunho ? (
              <tr>
                <td colSpan={5} className={styles.semDado}>
                  {t.vazio}
                </td>
              </tr>
            ) : null}
            {fixos.map((f) =>
              rascunho?.id === f.id ? (
                <Fragment key={f.id}>{formulario}</Fragment>
              ) : (
                <tr key={f.id} data-fixo={f.id}>
                  <td className={styles.forte}>{f.nome}</td>
                  <td>{f.valorTexto}</td>
                  <td className={styles.num}>{f.porMesTexto}</td>
                  <td>{f.cobra ?? "-"}</td>
                  <td>
                    {tirando === f.id ? (
                      <div className={styles.confirmaTirar} role="group" aria-label={t.confirmaTirar(f.nome)}>
                        <span>{t.confirmaTirar(f.nome)}</span>
                        {erro ? <span role="alert">{erro}</span> : null}
                        <Botao tamanho="md" carregando={ocupado} onClick={() => void executar(() => tirarFixoAction(f.id), () => setTirando(null))}>
                          {t.confirmar}
                        </Botao>
                        <Botao variante="ghost" tamanho="md" disabled={ocupado} onClick={() => setTirando(null)}>
                          {t.cancelar}
                        </Botao>
                      </div>
                    ) : (
                      <span className={styles.acoes}>
                        <Botao
                          variante="ghost"
                          tamanho="md"
                          aria-label={`${t.editar} ${f.nome}`}
                          onClick={() => {
                            setErro(null);
                            setRascunho({ id: f.id, nome: f.nome, valor: String(f.valor).replace(".", ","), moeda: f.moeda, periodo: f.periodo, cobra: f.cobra ?? "" });
                          }}
                        >
                          {t.editar}
                        </Botao>
                        <Botao
                          variante="ghost"
                          tamanho="md"
                          aria-label={`${t.tirar} ${f.nome}`}
                          onClick={() => {
                            setErro(null);
                            setTirando(f.id);
                          }}
                        >
                          {t.tirar}
                        </Botao>
                      </span>
                    )}
                  </td>
                </tr>
              ),
            )}
            {rascunho && rascunho.id === null ? formulario : null}
          </tbody>
        </table>
      </div>
      <div className={styles.rodapeFixos}>
        <Botao
          variante="secundario"
          tamanho="md"
          disabled={rascunho !== null}
          onClick={() => {
            setErro(null);
            setRascunho(VAZIO);
          }}
        >
          {t.adicionar}
        </Botao>
        <span className={styles.totalFixos}>{t.rodape(totalTexto)}</span>
      </div>
      <p className={styles.nota}>{t.nota}</p>
    </div>
  );
}
