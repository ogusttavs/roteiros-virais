"use client";

import { useEffect, useState } from "react";

import { textosLigacao } from "@/textos/conta-conectada";
import { Botao } from "@/ui/componentes/Botao";
import { Cartao } from "@/ui/componentes/Cartao";
import { Toast } from "@/ui/componentes/Toast";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { desligarInstagramAction, escolherInstagramAction } from "./instagram-acoes";
import { estadoDoCartao, type VisaoSeuInstagram } from "./seu-instagram-visao";
import styles from "./SeuInstagram.module.css";

const t = textosLigacao.tela;
const CAMINHO_PARA_LIGAR = "/api/meta/conectar";

/**
 * O cartão "Seu Instagram" da Conta (E19 PR 2): ligar o Instagram pelo Login da Meta, ver a conta ligada (nome, desde quando, última leitura), desligar com confirmação, escolher entre
 * várias contas, e ler a volta do diálogo (`?instagram=<código>`) e o problema guardado na conta. Mesmo cartão e mesma letra de "Instalar no celular". Só a dona da marca (fora do "ver
 * como") vê os botões; quem é só membro e o "ver como" leem o estado. O que a tela mostra vem montado do servidor (`seu-instagram-visao.ts`); o acesso guardado nunca chega aqui.
 */
export function SeuInstagram({ visao }: { visao: VisaoSeuInstagram }) {
  const tratarFalha = useTratarFalha();
  const [retorno, setRetorno] = useState(visao.retorno);
  const [confirmando, setConfirmando] = useState(false);
  const [desligando, setDesligando] = useState(false);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // A frase da volta fica na tela, mas o endereço perde o `?instagram=`: recarregar a página não a repete.
  useEffect(() => {
    if (!visao.retorno) return;
    const atual = new URL(window.location.href);
    if (!atual.searchParams.has("instagram")) return;
    atual.searchParams.delete("instagram");
    window.history.replaceState(window.history.state, "", `${atual.pathname}${atual.search}${atual.hash}`);
  }, [visao.retorno]);

  const estado = estadoDoCartao(visao);
  const { conta, candidatas, podeMexer } = visao;

  async function desligar() {
    if (desligando) return;
    setDesligando(true);
    setErro(null);
    setRetorno(null);
    try {
      const resultado = await desligarInstagramAction();
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setConfirmando(false);
      setAviso(t.desligado);
    } catch (falha) {
      setErro(tratarFalha(falha, t.erroDesligar, t.semConexao));
    } finally {
      setDesligando(false);
    }
  }

  async function escolher(contaId: string) {
    if (escolhendo) return;
    setEscolhendo(contaId);
    setErro(null);
    setRetorno(null);
    try {
      const resultado = await escolherInstagramAction(contaId);
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setAviso(t.escolher.escolhida);
    } catch (falha) {
      setErro(tratarFalha(falha, t.erroEscolher, t.semConexao));
    } finally {
      setEscolhendo(null);
    }
  }

  return (
    <>
      <Cartao className={styles.cartao} data-testid="seu-instagram" data-estado={estado}>
        <h3 className={styles.titulo}>{t.titulo}</h3>

        {retorno ? (
          <p className={retorno.tom === "ok" ? styles.retornoOk : styles.retornoAviso} role={retorno.tom === "ok" ? "status" : "alert"} data-retorno={retorno.codigo}>
            {retorno.frase}
          </p>
        ) : null}

        {candidatas.length > 0 ? (
          <div className={styles.escolher} data-parte="candidatas">
            {retorno?.codigo === "escolher" ? null : <p className={styles.explica}>{textosLigacao.retorno.escolher}</p>}
            <ul className={styles.lista}>
              {candidatas.map((c) => (
                <li key={c.contaId} className={styles.candidata} data-conta={c.contaId}>
                  <span className={styles.candidataNome}>
                    <span className={styles.valor}>{t.nomeDaConta(c.nome)}</span>
                    {c.pagina ? <span className={styles.pagina}>{t.escolher.pagina(c.pagina)}</span> : null}
                  </span>
                  <Botao type="button" variante="secundario" precisaDeRede carregando={escolhendo === c.contaId} disabled={escolhendo !== null} onClick={() => escolher(c.contaId)}>
                    {escolhendo === c.contaId ? t.escolher.escolhendo : t.escolher.esta}
                  </Botao>
                </li>
              ))}
            </ul>
            <p className={styles.nota}>{t.escolher.validade}</p>
          </div>
        ) : null}

        {conta ? (
          <div className={styles.ligada} data-parte="conta">
            <dl className={styles.dados}>
              <div className={styles.dado}>
                <dt className={styles.rotulo}>{t.rotulos.conta}</dt>
                <dd className={styles.valor}>{t.nomeDaConta(conta.nome)}</dd>
              </div>
              {conta.pagina ? (
                <div className={styles.dado}>
                  <dt className={styles.rotulo}>{t.rotulos.pagina}</dt>
                  <dd className={styles.texto}>{conta.pagina}</dd>
                </div>
              ) : null}
              <div className={styles.dado}>
                <dt className={styles.rotulo}>{t.rotulos.desde}</dt>
                <dd className={styles.texto}>{conta.desde}</dd>
              </div>
              <div className={styles.dado}>
                <dt className={styles.rotulo}>{t.rotulos.ultimaLeitura}</dt>
                <dd className={styles.texto}>{conta.ultimaLeitura ?? t.semLeitura}</dd>
              </div>
            </dl>
            {conta.erro ? (
              <p className={styles.erroDaConta} role="alert" data-parte="erro-da-conta">
                {conta.erro}
              </p>
            ) : null}
          </div>
        ) : null}

        {estado === "sem-ligacao" || estado === "indisponivel" ? <SemLigacao visao={visao} /> : null}

        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}

        {podeMexer && conta ? (
          confirmando ? (
            <div className={styles.confirma} role="alertdialog" aria-labelledby="confirma-desligar-instagram" data-parte="confirmar-desligar">
              <p id="confirma-desligar-instagram" className={styles.explica}>
                {t.confirmaDesligar}
              </p>
              <div className={styles.acoes}>
                <Botao type="button" variante="perigo" precisaDeRede carregando={desligando} onClick={desligar}>
                  {desligando ? t.desligando : t.confirmaSim}
                </Botao>
                <button type="button" className={styles.cancelar} disabled={desligando} onClick={() => setConfirmando(false)}>
                  {t.confirmaNao}
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.acoes}>
              {conta.erro && visao.ligacaoAberta ? (
                <a className={styles.ligar} href={CAMINHO_PARA_LIGAR}>
                  {t.ligarDeNovo}
                </a>
              ) : null}
              <Botao type="button" variante="secundario" onClick={() => setConfirmando(true)}>
                {t.desligar}
              </Botao>
            </div>
          )
        ) : null}

        {!podeMexer && (conta || estado === "sem-ligacao") ? <p className={styles.nota}>{visao.verComo ? t.verComo : t.soDono}</p> : null}
      </Cartao>
      <Toast texto={aviso ?? ""} aberto={aviso !== null} onFechar={() => setAviso(null)} duracaoMs={4000} />
    </>
  );
}

/** Sem conta ligada: o convite com o botão (dono, ligação aberta), o aviso do grupo pequeno e, onde não dá, a frase de quem não pode. */
function SemLigacao({ visao }: { visao: VisaoSeuInstagram }) {
  if (!visao.ligacaoAberta) {
    return (
      <p className={styles.explica} data-parte="indisponivel">
        {visao.aprovadoPelaMeta ? t.indisponivelAprovado : t.indisponivel}
      </p>
    );
  }
  return (
    <div className={styles.convite} data-parte="convite">
      <p className={styles.explica}>{t.explica}</p>
      <p className={styles.explica}>{t.oQueLemos}</p>
      <p className={styles.explica}>{t.oQueNunca}</p>
      {visao.podeMexer ? (
        <a className={styles.ligar} href={CAMINHO_PARA_LIGAR}>
          {t.ligar}
        </a>
      ) : null}
      {visao.aprovadoPelaMeta ? null : (
        <p className={styles.nota} data-parte="em-teste">
          {t.emTeste}
        </p>
      )}
    </div>
  );
}
