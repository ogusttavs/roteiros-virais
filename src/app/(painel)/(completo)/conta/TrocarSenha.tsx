"use client";

import { useRef, useState, type FormEvent } from "react";

import { conferirSenhaNova } from "@/lib/senha-regras";
import { textosSenha } from "@/textos/senha";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { Cartao } from "@/ui/componentes/Cartao";
import { Toast } from "@/ui/componentes/Toast";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { trocarSenhaAction } from "./acoes-senha";
import styles from "./TrocarSenha.module.css";

const t = textosSenha.conta;

/**
 * O cartão "Senha" da Conta (E58): fechado, é uma frase e um botão; aberto, a senha de agora, a nova e a repetição. A nova vale com 8 caracteres ou mais; ao trocar, o
 * servidor encerra a sessão dos outros aparelhos (esta continua aberta). Sem rede o botão fica desligado, como nos outros formulários da Conta.
 */
export function TrocarSenha() {
  const tratarFalha = useTratarFalha();
  const { avisarRedeOk } = useConexao();
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [repetida, setRepetida] = useState("");
  const [erroAtual, setErroAtual] = useState<string | undefined>();
  const [erroNova, setErroNova] = useState<string | undefined>();
  const [erroRepetida, setErroRepetida] = useState<string | undefined>();
  const [erroForma, setErroForma] = useState<string | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [avisoAberto, setAvisoAberto] = useState(false);
  const atualRef = useRef<HTMLInputElement>(null);

  function limpar() {
    setAtual("");
    setNova("");
    setRepetida("");
    setErroAtual(undefined);
    setErroNova(undefined);
    setErroRepetida(undefined);
    setErroForma(null);
  }

  async function trocar(evento: FormEvent) {
    evento.preventDefault();
    if (trocando) return;
    setErroAtual(undefined);
    setErroNova(undefined);
    setErroRepetida(undefined);
    setErroForma(null);

    const problema = conferirSenhaNova(nova, repetida);
    if (problema === "curta") return void setErroNova(textosSenha.erroCurta);
    if (problema === "longa") return void setErroNova(textosSenha.erroLonga);
    if (problema === "nao_conferem") return void setErroRepetida(textosSenha.erroNaoConferem);

    setTrocando(true);
    try {
      const resultado = await trocarSenhaAction({ atual, nova });
      if (!resultado.ok) {
        // A frase do servidor diz qual campo errou: a senha de agora pinta o campo dela, o resto fica abaixo do botão.
        if (resultado.erro === t.atualErrada) {
          setErroAtual(resultado.erro);
          atualRef.current?.focus();
        } else if (resultado.erro === t.igual) setErroNova(resultado.erro);
        else setErroForma(resultado.erro);
        return;
      }
      avisarRedeOk();
      limpar();
      setAberto(false);
      setAvisoAberto(true);
    } catch (falha) {
      setErroForma(tratarFalha(falha, textosSenha.erroDeServidor, textosSenha.semConexao));
    } finally {
      setTrocando(false);
    }
  }

  return (
    <>
      <Cartao className={styles.senha} data-teste="trocar-senha">
        <h3 className={styles.titulo}>{t.titulo}</h3>
        <p className={styles.explica}>{t.explica}</p>
        {aberto ? (
          <form className={styles.forma} onSubmit={trocar}>
            <Campo
              ref={atualRef}
              rotulo={t.campoAtual}
              type="password"
              name="senha-de-agora"
              autoComplete="current-password"
              required
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              erro={erroAtual}
            />
            <Campo
              rotulo={t.campoNova}
              type="password"
              name="senha-nova"
              autoComplete="new-password"
              required
              ajuda={textosSenha.ajudaMinimo}
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              erro={erroNova}
            />
            <Campo
              rotulo={textosSenha.campoRepetir}
              type="password"
              name="senha-nova-repetida"
              autoComplete="new-password"
              required
              value={repetida}
              onChange={(e) => setRepetida(e.target.value)}
              erro={erroRepetida}
            />
            {erroForma ? (
              <p className={styles.erro} role="alert">
                {erroForma}
              </p>
            ) : null}
            <div className={styles.acoes}>
              <Botao type="submit" variante="secundario" carregando={trocando} precisaDeRede>
                {trocando ? t.salvando : t.salvar}
              </Botao>
              <button
                type="button"
                className={styles.cancelar}
                onClick={() => {
                  limpar();
                  setAberto(false);
                }}
              >
                {t.cancelar}
              </button>
            </div>
          </form>
        ) : (
          <Botao type="button" variante="secundario" className={styles.abrir} onClick={() => setAberto(true)}>
            {t.abrir}
          </Botao>
        )}
      </Cartao>
      <Toast texto={t.feito} aberto={avisoAberto} onFechar={() => setAvisoAberto(false)} duracaoMs={6000} />
    </>
  );
}
