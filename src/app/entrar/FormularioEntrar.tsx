"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { textosEntrar } from "@/textos/entrar";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./page.module.css";

export function FormularioEntrar() {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [mandandoLink, setMandandoLink] = useState(false);
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [erroEmail, setErroEmail] = useState<string | null>(null);
  const [erroForma, setErroForma] = useState<string | null>(null);
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [linkEnviadoPara, setLinkEnviadoPara] = useState<string | null>(null);

  /**
   * O cliente do better-auth REJEITA (TypeError) quando a rede cai em vez de devolver `{ error }`
   * (V7, item 4 do PROXIMO.md). O tempo limite de `auth-client.ts` aborta o pedido e ele rejeita com
   * AbortError, que `ehFalhaDeRede` nao reconhece: para quem esta entrando, conexao que trava e
   * conexao que cai sao a mesma coisa, entao os dois viram a frase de rede.
   */
  function fraseDaFalha(falha: unknown, padrao: string, aoCair: string): string {
    if (
      falha instanceof DOMException &&
      (falha.name === "AbortError" || falha.name === "TimeoutError")
    ) {
      return aoCair;
    }
    return tratarFalha(falha, padrao, aoCair);
  }

  async function entrarComSenha(evento: FormEvent) {
    evento.preventDefault();
    if (entrando) return;
    setErroSenha(null);
    setErroEmail(null);
    setErroForma(null);
    setErroLink(null);
    setEntrando(true);

    let entrou = false;
    try {
      const { data, error } = await authClient.signIn.email({ email, password: senha });

      if (error || !data) {
        // 400 e 401 sao "senha errada"; o limite de tentativas (429) e a falha do servidor (5xx)
        // nao sao, e a frase de "e-mail ou senha nao conferem" mentia para os dois.
        if (error?.status === 429) setErroForma(textosEntrar.muitasTentativas);
        else if (error && error.status >= 500) setErroForma(textosEntrar.erroDeServidor);
        else setErroSenha(textosEntrar.erroGenerico);
        return;
      }
      entrou = true;
      router.push(data.user.role === "admin" ? "/admin/clientes" : "/hoje");
      router.refresh();
    } catch (falha) {
      setErroForma(fraseDaFalha(falha, textosEntrar.erroDeServidor, textosEntrar.semConexao));
    } finally {
      // No sucesso o botao continua em "entrando" ate a pagina trocar: reabilitar aqui deixava tocar
      // de novo em rede lenta, e o quarto pedido em 10 s recebia 429 com a senha certa.
      if (!entrou) setEntrando(false);
    }
  }

  async function entrarSemSenha() {
    if (mandandoLink) return;
    if (!email) {
      setErroEmail(textosEntrar.erroSemEmail);
      return;
    }
    setErroEmail(null);
    setErroSenha(null);
    setErroForma(null);
    setErroLink(null);
    setMandandoLink(true);

    try {
      const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/hoje" });

      if (error) {
        setErroLink(error.status === 429 ? textosEntrar.muitasTentativas : textosEntrar.erroLink);
        return;
      }
      setLinkEnviadoPara(email);
    } catch (falha) {
      setErroLink(fraseDaFalha(falha, textosEntrar.erroLink, textosEntrar.semConexaoLink));
    } finally {
      setMandandoLink(false);
    }
  }

  if (linkEnviadoPara) {
    return (
      <>
        <p className={styles.confirmacao}>{textosEntrar.linkEnviado(linkEnviadoPara)}</p>
        <button
          type="button"
          className={styles.linkAcao}
          disabled={mandandoLink}
          onClick={() => void entrarSemSenha()}
        >
          {mandandoLink ? textosEntrar.mandandoLink : textosEntrar.mandarDeNovo}
        </button>
        {/* "Mandar de novo" que falha nao pode parecer que mandou: o texto do botao volta ao de antes. */}
        {erroLink ? (
          <p className={styles.erroAviso} role="alert">
            {erroLink}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <form className={styles.forma} onSubmit={entrarComSenha}>
        <Campo
          rotulo={textosEntrar.campoEmail}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          erro={erroEmail ?? undefined}
        />
        <Campo
          rotulo={textosEntrar.campoSenha}
          type="password"
          name="senha"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
          erro={erroSenha ?? undefined}
        />
        {/* Rede, limite e falha do servidor nao sao erro da senha: ficam a parte, sem pintar o campo. */}
        {erroForma ? (
          <p className={styles.erroAviso} role="alert">
            {erroForma}
          </p>
        ) : null}
        <Botao type="submit" tamanho="lg" carregando={entrando}>
          {entrando ? textosEntrar.entrando : textosEntrar.botaoEntrar}
        </Botao>
      </form>
      <button
        type="button"
        className={styles.linkAcao}
        disabled={mandandoLink}
        onClick={() => void entrarSemSenha()}
      >
        {mandandoLink ? textosEntrar.mandandoLink : textosEntrar.linkSemSenha}
      </button>
      {erroLink ? (
        <p className={styles.erroAviso} role="alert">
          {erroLink}
        </p>
      ) : null}
    </>
  );
}
